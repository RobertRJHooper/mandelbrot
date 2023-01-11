"use strict";

var parseViewBox = _.memoize(function (s) {
    if (typeof s != 'string') {
        throw new TypeError('string expected');
    }

    const arr = s.split(/\s*[\s,]\s*/).map(x => Number.parseFloat(x));

    if (arr.length != 4) {
        throw new TypeError('four numbers expected for a view box');
    }

    const [left, bottom, width, height] = arr;

    return {
        left: left,
        right: left + width,
        bottom: bottom,
        top: bottom + height,
        width: width,
        height: height
    };
});


/*
linear coordinate transformations of values from one rectangle box to another.
The source and target rectangles are in the corresponding coordinate space.
values are dimensions in the source space to transform to target space
*/
function boxToBoxTransform(source, target, values, flipVertical = true) {
    const fx = target.width / source.width;
    const fy = target.height / source.height;
    const fv = flipVertical ? -1 : 1;
    const out = {};

    if (typeof values.x !== 'undefined') {
        out.x = target.left + (values.x - source.left) * fx;
    }

    if (typeof values.left !== 'undefined') {
        out.left = target.left + (values.left - source.left) * fx;
    }

    if (typeof values.right !== 'undefined') {
        out.right = target.left + (values.right - source.left) * fx;
    }

    if (typeof values.y !== 'undefined') {
        out.y = target.top + (values.y - source.top) * fy * fv;
    }

    if (typeof values.top !== 'undefined') {
        out.top = target.top + (values.top - source.top) * fy * fv;
    }

    if (typeof values.bottom !== 'undefined') {
        out.bottom = target.top + (values.bottom - source.top) * fy * fv;
    }

    if (typeof values.width !== 'undefined') {
        out.width = values.width * fx;
    }

    if (typeof values.height !== 'undefined') {
        out.height = values.height * fy;
    }

    return out;
}

class App extends React.Component {
    static initialViewBox = "-2 -2 4 4";

    static defaultProps = {
        resX: 800,
        resY: 600,
    }

    constructor(props) {
        super(props);

        this.state = {
            viewBox: App.initialViewBox,
            infoModalVisible: false,
            samplerVisible: false,
            samplerC: math.complex(0, 0),
        }

        this.onBoxSelection = this.onBoxSelection.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
        this.onInfoButtonClick = () => this.setState({ infoModalVisible: !this.state.infoModalVisible });
        this.onInfoCloseClick = () => this.setState({ infoModalVisible: false });
    }

    render() {
        const { resX, resY } = this.props;
        const { viewBox, infoModalVisible, samplerVisible, samplerC } = this.state;
        const showSampler = samplerVisible && (samplerC != null);

        return (
            <div className="app">
                <MandelbrotSet
                    viewBox={viewBox}
                    resX={resX}
                    resY={resY} />

                <div style={{ display: (showSampler ? "" : "none") }}>
                    <Sampler
                        viewBox={viewBox}
                        c={samplerC}
                        maxIterations={100} />
                </div>

                <Selector
                    viewBox={viewBox}
                    onPointHover={this.onPointHover}
                    onBoxSelection={this.onBoxSelection} />

                <Navbar
                    sampleButtonActivated={samplerVisible}
                    onSampleToggle={() => this.setState({ samplerVisible: !this.state.samplerVisible })}
                    onResetClick={() => this.setState({ viewBox: App.initialViewBox, infoModalVisible: false })}
                    onInfoButtonClick={this.onInfoButtonClick} />

                <InfoModal
                    visible={infoModalVisible}
                    onCloseClick={this.onInfoCloseClick} />
            </div>
        );
    }

    onBoxSelection(box) {
        console.log("sub box selected", box);
        const viewBox = [box.left, box.top - box.height, box.width, box.height].map((x) => x.toString()).join(' ');

        if (viewBox != this.state.viewBox) {
            this.setState({ viewBox: viewBox });
        }
    }

    onPointHover(viewBoxPoint) {
        if (viewBoxPoint && this.state.samplerVisible) {
            const sampleC = math.complex(viewBoxPoint.x, viewBoxPoint.y);

            if (sampleC != this.state.samplerC) {
                this.setState({ samplerC: sampleC, });
            }
        }
    }
}

class MandelbrotSet extends React.Component {
    static defaultProps = {
        viewBox: "-2 -2 4 4",
        resX: 200,
        resY: 200,
        frameThrottle: 5,
    }

    constructor(props) {
        super(props);

        this.state = {
            modelID: null,
            frameIndex: null,
            frameBitmap: null,
        }

        this.canvas = React.createRef();
        this.worker = null;

        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target == this.canvas.current) {
                    this.setCanvasBlur();
                }
            }
        });
    }

    render() {
        return (
            <canvas
                ref={this.canvas}
                width="0"
                height="0"
                className="mandelbrotset">
            </canvas>
        );
    }

    setCanvasBlur() {
        const canvas = this.canvas.current;
        const canvasWidth = canvas.getAttribute("width");
        const boxWidth = canvas.getBoundingClientRect().width;
        const currentBlurPixels = canvas.style.getProperty('--blur');
        const newBlurPixels = 0.5 * boxWidth / canvasWidth;

        if (canvasWidth && newBlurPixels != currentBlurPixels) {
            canvas.style.setProperty('--blur', newBlurPixels + "px");
        }
    }

    startModel() {
        const { viewBox, resX, resY, frameThrottle } = this.props;

        // create a unique model id
        const modelID = Date.now() + "" + Math.floor(Math.random() * 1000000);
        console.debug('starting model', modelID);

        // set initial model state details
        this.setState({
            modelID: modelID,
            frameIndex: null,
            bitmap: null,
        });

        // start calculations on worker
        const vb = parseViewBox(viewBox);

        this.worker.postMessage({
            command: 'init',
            modelID: modelID,
            resX: resX,
            resY: resY,
            viewTopLeft: math.complex(vb.left, vb.top),
            viewWidth: vb.width,
            viewHeight: vb.height,
            frameLimit: frameThrottle,
        });
    }

    workerMessage(message) {
        const { modelID, frameBitmap, frameIndex } = message.data;

        this.setState(function (state, props) {
            if (state.modelID != modelID) {
                console.debug('orphan message from worker', modelID);
                return {};
            }

            // don't display out of sequence frames
            if (state.frameIndex >= frameIndex) {
                console.debug('late frame returned', modelID, frameIndex);
                return {};
            }

            // set state
            return {
                frameIndex: frameIndex,
                frameBitmap: frameBitmap,
            };
        });
    }

    componentDidMount() {
        this.worker = new Worker('worker.js');
        this.worker.onmessage = this.workerMessage.bind(this);
        this.startModel();
        this.resizeObserver.observe(this.canvas.current);
    }

    componentDidUpdate(prevProps, prevState) {
        const { viewBox, resX, resY } = this.props;

        const modelChanged = viewBox != prevProps.viewBox
            || resX != prevProps.resX
            || resY != prevProps.resY;
        modelChanged && this.startModel();

        // paint a new frame to the canvas
        const { modelID, frameIndex, frameBitmap } = this.state;
        const frameUpdate = !modelChanged && frameIndex != prevState.frameIndex;

        if (frameUpdate) {
            const canvas = this.canvas.current;
            const frameWidth = frameBitmap.width;
            const frameHeight = frameBitmap.height;
            const canvasWidth = canvas.getAttribute("width");
            const canvasHeight = canvas.getAttribute("height");

            // check/update canvas dimensions
            if (canvasWidth != frameWidth || canvasHeight != frameHeight) {
                canvas.setAttribute("width", frameWidth);
                canvas.setAttribute("height", frameHeight);
            }

            // paint bitmap to canvas
            const context = canvas.getContext('2d', { alpha: false });
            context.drawImage(frameBitmap, 0, 0);

            // update blur level
            this.setCanvasBlur();

            // issue update to worker to increase frame limit
            const newFrameLimit = frameIndex + this.props.frameThrottle;
            this.worker.postMessage({ command: 'frameLimit', modelID: modelID, frameLimit: newFrameLimit });
        }
    }

    componentWillUnmount() {
        this.worker && this.worker.terminate();
        this.worker = null;
        this.resizeObserver.unobserve(this.canvas.current);
    }
}

class Sampler extends React.Component {
    static floatFormat = new Intl.NumberFormat(
        "us-en",
        {
            signDisplay: 'always',
            minimumFractionDigits: 15,
            maximumFractionDigits: 15
        }).format;


    render() {
        const { c, maxIterations } = this.props;
        const viewBox = parseViewBox(this.props.viewBox);

        // generate sample
        // should be quick enough to be in here in render
        const sample = mbSample(c, maxIterations);
        const escaped = sample.inMBS === false; // allow undetermined as in the set
        const escapedClass = escaped ? "sampler-escaped" : "sampler-bounded";

        const polyLine = sample.zn.map(zi => `${zi.re},${zi.im}`).join(' ');
        const pointSize = viewBox.width / 80;
        const points = sample.zn.map((zi, i) =>
            <svg
                key={i}
                x={zi.re - pointSize / 2}
                y={zi.im - pointSize / 2}
                width={pointSize + "px"}
                height={pointSize + "px"}
                viewBox="-10 -10 20 20">
                <circle r="10" className={escapedClass} />
                <text x="-9" y="3"
                    lengthAdjust="spacingAndGlyphs" textLength="18px"
                    transform="scale(1,-1)"
                    style={{ font: "monospace 10px", stroke: "black", fill: "black" }}>
                    {i}
                </text>
            </svg>
        );

        const tooltipLeft = (100 * (c.re - viewBox.left) / viewBox.width) + "%";
        const tooltipTop = (100 * (viewBox.top - c.im) / viewBox.height) + "%";

        return (
            <div ref={this.div}>
                {/* numbered points and joining line */}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="sampler"
                    viewBox={this.props.viewBox}
                    transform="scale(1,-1)" /* show complex plane with imaginary axis the right way up */
                    preserveAspectRatio="none">
                    <polyline points={polyLine} fill="none"></polyline>
                    {points}
                </svg>

                {/* tooltip */}
                <div className="sampler-infobox" style={{ left: tooltipLeft, top: tooltipTop }}>
                    <p>{Sampler.floatFormat(c.re)}</p>
                    <p>{Sampler.floatFormat(c.im)}i</p>
                    <hr></hr>
                    <p>
                        z<sub>n</sub>
                        <span className={escapedClass}>
                            {escaped ? ` escapes ` : " remains bounded"}
                        </span>
                        {escaped ? `at n=${sample.escapeAge}` : ""}
                    </p>
                </div>
            </div>
        );
    }
}

// class to handle zooming, selecting, hovering
class Selector extends React.Component {
    static defaultProps = {
        onBoxSelection: null,
        onPointHover: null,
    }

    constructor(props) {
        super(props);

        this.state = {
            clickedPoint: null,
            currentPoint: null,
        }

        this.div = React.createRef();
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    render() {
        const { clickedPoint, currentPoint } = this.state;
        const show = clickedPoint && currentPoint;
        const box = show && this.boxGeometry(clickedPoint, currentPoint);
        const boxStyle = box ? { ...box, visibility: "visible" } : { visibility: "hidden" };

        return (
            <div ref={this.div}
                className="selector"
                onMouseDown={this.onMouseDown}
                onMouseUp={this.onMouseUp}>
                <div className="selector-box"
                    style={boxStyle}>
                </div>
            </div>
        );
    }

    componentDidMount() {
        window.addEventListener("mousemove", this.onMouseMove);
        window.addEventListener("mouseup", this.onMouseUp);
    }

    componentWillUnmount() {
        window.removeEventListener("mousemove", this.onMouseMove);
        window.removeEventListener("mouseup", this.onMouseUp);
    }

    // get box dimensions maintaining aspect ration of div container
    boxGeometry(clickedPoint, currentPoint) {
        const divRect = this.div.current.getBoundingClientRect();
        const aspect = divRect.height ? divRect.width / divRect.height : 1;

        const dx = currentPoint.x - clickedPoint.x;
        const dy = currentPoint.y - clickedPoint.y;
        const diagonal = Math.sqrt(dx * dx + dy * dy);

        const rect = {
            left: clickedPoint.x,
            top: clickedPoint.y,
            width: diagonal * (Math.sign(dx) || 1),
            height: diagonal / aspect * (Math.sign(dy) || 1),
        }

        // inside out
        if (rect.width < 0) {
            rect.left = rect.left + rect.width;
            rect.width = -1 * rect.width;
        }

        if (rect.height < 0) {
            rect.top = rect.top + rect.height;
            rect.height = -1 * rect.height;
        }

        return rect;
    }

    onMouseMove(e) {
        const { onPointHover, viewBox } = this.props;
        const { currentPoint, clickedPoint } = this.state;
        const divRect = this.div.current.getBoundingClientRect();

        // clip position to the app frame
        const clientX = Math.min(Math.max(divRect.left, e.clientX), divRect.right);
        const clientY = Math.min(Math.max(divRect.top, e.clientY), divRect.bottom);
        const clipped = clientX != e.clientX || clientY != e.clientY;

        const newCurrentPoint = { x: clientX - divRect.left, y: clientY - divRect.top };
        const currentPointMoved = !currentPoint || (newCurrentPoint.x != currentPoint.x) || (newCurrentPoint.y != currentPoint.y);

        // report new state to this component
        if (currentPointMoved) {
            this.setState({ currentPoint: newCurrentPoint });
        }

        // hover callback to parent
        if (onPointHover && currentPointMoved && !clickedPoint && !clipped) {
            const viewBoxPoint = boxToBoxTransform(divRect, parseViewBox(viewBox), { x: clientX, y: clientY });
            onPointHover(viewBoxPoint);
        }
    }

    onMouseDown(e) {
        const divRect = this.div.current.getBoundingClientRect();
        this.setState({ clickedPoint: { x: e.clientX - divRect.left, y: e.clientY - divRect.top } });
    }

    onMouseUp(e) {
        const { currentPoint, clickedPoint } = this.state;
        const { onBoxSelection, viewBox } = this.props;
        const divRect = this.div.current.getBoundingClientRect();

        // check if the mouse is outside the div - in this case cancel selection
        if (onBoxSelection && clickedPoint && currentPoint) {
            const eventInDiv = (e.clientX <= divRect.right)
                && (e.clientX >= divRect.left)
                && (e.clientY <= divRect.bottom)
                && (e.clientY >= divRect.top);

            if (eventInDiv) {
                const bg = this.boxGeometry(clickedPoint, currentPoint);
                const clientBox = {
                    left: divRect.left + bg.left,
                    top: divRect.top + bg.top,
                    width: bg.width,
                    height: bg.height
                };

                if (bg.width && bg.height) {
                    onBoxSelection(boxToBoxTransform(divRect, parseViewBox(viewBox), clientBox));
                }
            }
        }

        this.setState({ clickedPoint: null });
    }
}

class Navbar extends React.Component {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <ul className="navbar">
                <li className="navbar-li"
                    onMouseDown={() => this.setState({ highlightResetButton: true })}
                    onMouseUp={() => this.setState({ highlightResetButton: false })}
                    onClick={this.props.onResetClick}>
                    {/* house icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
                        <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
                    </svg>
                </li>
                <li className={this.props.sampleButtonActivated ? "navbar-li navbar-li-active" : "navbar-li"}
                    onClick={this.props.onSampleToggle}>
                    {/* cursor icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z" />
                    </svg>
                </li>
                <li className="navbar-li"
                    onClick={() => this.props.onInfoButtonClick()}>
                    {/* info icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="m9.708 6.075-3.024.379-.108.502.595.108c.387.093.464.232.38.619l-.975 4.577c-.255 1.183.14 1.74 1.067 1.74.72 0 1.554-.332 1.933-.789l.116-.549c-.263.232-.65.325-.905.325-.363 0-.494-.255-.402-.704l1.323-6.208Zm.091-2.755a1.32 1.32 0 1 1-2.64 0 1.32 1.32 0 0 1 2.64 0Z" />
                    </svg>
                </li>
            </ul>

        );
    }

}

class InfoModal extends React.Component {
    static defaultProps = {
        visible: false,
        onCloseClick: null,
    }

    constructor(props) {
        super(props);
        this.backdrop = React.createRef();
        this.onClick = this.onClick.bind(this);
    }

    render() {
        return (
            <div ref={this.backdrop} className="info-modal" style={this.props.visible ? {} : { display: 'none' }}>
                <div className="info-modal-content">
                    {/* modal close X button */}
                    <span
                        className="info-modal-close"
                        onClick={() => this.props.onCloseClick && this.props.onCloseClick()}>
                        &times;
                    </span>
                    {/* start of modal content */}
                    <h1>Mandelbrot Set Explorer</h1>
                    <p>
                        The Mandelbrot set is the set of complex numbers <var>c</var> for which the
                        function <var>f<sub>c</sub>(z)=z<sup>2</sup>+c</var> does not diverge to infinity
                        when iterated from <var>z=0</var>. This app displays the Mandelbrot set and
                        allows zooming for exploration.
                    </p>
                    <p>
                        When a point is in Mandelbrot Set, the path will remain bounded.
                        When a point is not in the set, the path will eventually escape
                        (<var>|z<sub>n</sub>| &gt;= 2</var>) and this implies that
                        (<var>z<sub>n</sub></var>) will be unbounded as <var>n</var> increases.
                        Black points in the image are points in the set. Points outside the set are
                        displayed in various colour. When two points have the same escape iteration they have
                        the same colour.
                    </p>
                    <p>
                        The home button returns the view to the zoomed-out starting level.
                        The initial value (<var>z<sub>0</sub></var>)
                        and the path of the iterations (<var>z<sub>n</sub></var>) of a single point
                        can be viewed by selecting the arrow button and hovering/selecting a point.
                    </p>
                    <p>
                        The set is fractal in nature meaning that shapes seen at one zoom level will recur at higher
                        zoom levels continuing indefinitely.
                    </p>
                    <p>
                        More infomation is available on the Wikipedia page: <a href="https://en.wikipedia.org/wiki/Mandelbrot_set">https://en.wikipedia.org/wiki/Mandelbrot_set</a>
                    </p>
                    {/* end of modal content */}
                </div>
            </div >
        );
    }

    componentDidMount() {
        window.addEventListener("click", this.onClick);
    }

    componentWillUnmount() {
        window.removeEventListener("click", this.onClick);
    }

    onClick(event) {
        if (event.target == this.backdrop.current) {
            this.props.onCloseClick && this.props.onCloseClick();
        }
    }
}
