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
coordinate transformations from client space to viewBox space
clientRect is the view in client space
viewBox is the view in user space
values are the coordinates/dimensions in client space to convert
*/
function clientToViewBox(clientRect, viewBox, values) {
    const fx = viewBox.width / clientRect.width;
    const fy = viewBox.height / clientRect.height;
    const out = {};

    if (typeof values.x !== 'undefined') {
        out.x = viewBox.left + (values.x - clientRect.left) * fx;
    }

    if (typeof values.left !== 'undefined') {
        out.left = viewBox.left + (values.left - clientRect.left) * fx;
    }

    if (typeof values.right !== 'undefined') {
        out.right = viewBox.left + (values.right - clientRect.left) * fx;
    }

    if (typeof values.y !== 'undefined') {
        out.y = viewBox.top - (values.y - clientRect.top) * fy;
    }

    if (typeof values.top !== 'undefined') {
        out.top = viewBox.top - (values.top - clientRect.top) * fy;
    }

    if (typeof values.bottom !== 'undefined') {
        out.bottom = viewBox.top - (values.bottom - clientRect.top) * fy;
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
    static defaultViewBox = "-2 -2 4 4";

    constructor(props) {
        super(props);

        this.state = {
            viewBox: App.defaultViewBox,

            sampleToggle: false,
            sampleC: math.complex(0, 0),
            sampleTooltipX: 0,
            sampleTooltipY: 0,
        }

        this.onBoxSelection = this.onBoxSelection.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
    }

    render() {
        const { viewBox, sampleToggle, sampleC, sampleTooltipX, sampleTooltipY } = this.state;
        const showSample = sampleToggle && (sampleC != null);

        return (
            <div className="app">
                <div className="app-nav" style={{ zIndex: 1 }}>
                    <Navbar
                        sampleToggle={sampleToggle}
                        onSampleToggle={() => this.setState((state, props) => ({ sampleToggle: !state.sampleToggle }))}
                        onResetClick={() => this.setState({ viewBox: App.defaultViewBox })} />
                </div>
                <div className="app-layer" style={{ zIndex: 0 }}>
                    <Selector
                        viewBox={viewBox}
                        onPointHover={this.onPointHover}
                        onBoxSelection={this.onBoxSelection} />
                </div>
                <div className="app-layer" style={{ zIndex: -1, visibility: (showSample ? "visible" : "hidden") }}>
                    <MandelbrotSample
                        viewBox={viewBox}
                        c={sampleC}
                        maxIterations={100}
                        tooltipX={sampleTooltipX}
                        tooltipY={sampleTooltipY} />
                </div>
                <div className="app-layer" style={{ zIndex: -2 }}>
                    <MandelbrotSet viewBox={viewBox} />
                </div>
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

    onPointHover(clientPoint, viewBoxPoint) {
        if (clientPoint && viewBoxPoint && this.state.sampleToggle) {
            const sampleC = math.complex(viewBoxPoint.x, viewBoxPoint.y);

            if (sampleC != this.state.sampleC) {
                this.setState({
                    sampleC: sampleC,
                    sampleTooltipX: clientPoint.x,
                    sampleTooltipY: clientPoint.y,
                });
            }
        }
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
                <li className={this.props.sampleToggle ? "navbar-li navbar-li-active" : "navbar-li"}
                    onClick={this.props.onSampleToggle}>
                    {/* cursor icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z" />
                    </svg>
                </li>
                <li className="navbar-li">
                    {/* info icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="m9.708 6.075-3.024.379-.108.502.595.108c.387.093.464.232.38.619l-.975 4.577c-.255 1.183.14 1.74 1.067 1.74.72 0 1.554-.332 1.933-.789l.116-.549c-.263.232-.65.325-.905.325-.363 0-.494-.255-.402-.704l1.323-6.208Zm.091-2.755a1.32 1.32 0 1 1-2.64 0 1.32 1.32 0 0 1 2.64 0Z" />
                    </svg>
                </li>
            </ul>

        );
    }

}

class MandelbrotSet extends React.Component {
    static defaultProps = {
        viewBox: "-2 -2 4 4",
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
    }

    render() {
        return (
            <canvas ref={this.canvas} width="0" height="0" className="mandelbrotset"></canvas>
        );
    }

    startModel() {
        const { viewBox, frameThrottle } = this.props;

        // create a unique model id
        const modelID = Date.now() + "" + Math.floor(Math.random() * 1000000);
        console.debug('starting model', modelID);

        // parse viewbox
        const vb = parseViewBox(viewBox);

        // save initial model state details
        this.setState({
            modelID: modelID,
            frameIndex: null,
            bitmap: null,
        });

        // start calculations on worker
        this.worker.postMessage({
            command: 'init',
            modelID: modelID,
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
    }

    componentDidUpdate(prevProps, prevState) {
        const modelChanged = this.props.viewBox != prevProps.viewBox;
        modelChanged && this.startModel();

        // paint a new frame to the canvas
        const { frameIndex, frameBitmap } = this.state;
        const frameChanged = frameIndex != prevState.frameIndex;

        if (!modelChanged && frameChanged && frameBitmap) {
            const canvas = this.canvas.current;

            const frameWidth = frameBitmap.width;
            const frameHeight = frameBitmap.height;
            const canvasWidth = canvas.getAttribute("width");
            const canvasHeight = canvas.getAttribute("width");

            // check/update canvas dimensions
            if (canvasWidth != frameWidth || canvasHeight != frameHeight) {
                canvas.setAttribute("width", frameWidth);
                canvas.setAttribute("height", frameHeight);
            }

            // paint bitmap to canvas
            const context = canvas.getContext('2d', { alpha: false });
            context.drawImage(frameBitmap, 0, 0);

            // issue update to worker to increase frame limit
            const newFrameLimit = frameIndex + this.props.frameThrottle;
            this.worker.postMessage({ command: 'frameLimit', modelID: this.state.modelID, frameLimit: newFrameLimit });
        }
    }

    componentWillUnmount() {
        this.worker && this.worker.terminate();
    }
}

class MandelbrotSample extends React.Component {
    static floatFormat = new Intl.NumberFormat(
        "us-en",
        {
            signDisplay: 'always',
            minimumFractionDigits: 15,
            maximumFractionDigits: 15
        }).format;

    render() {
        const { viewBox, c, maxIterations, tooltipX, tooltipY } = this.props;

        // generate sample
        // should be quick enough to be in here in render
        const sample = mbSample(c, maxIterations);
        const escaped = sample.inMBS === false; // allow undetermined as in the set
        const escapedClass = escaped ? "mandelbrotsample-escaped" : "mandelbrotsample-bounded";

        const polyLine = sample.zn.map(zi => `${zi.re},${zi.im}`).join(' ');
        const pointSize = (parseViewBox(viewBox).width / 100);

        const points = sample.zn.map((zi, i) =>
            <svg
                x={zi.re - pointSize/2}
                y={zi.im - pointSize/2}
                width={pointSize+ "px"}
                height={pointSize+ "px"}
                viewBox="-10 -10 20 20">
                <circle r="10" className={escapedClass} />
                <text x="-9" y="6"
                    lengthAdjust="spacingAndGlyphs" textLength="18px"
                    transform="scale(1,-1)"
                    style={{ font: "monospace 10px", stroke: "black", fill: "black" }}>
                    {i}
                </text>
            </svg>
        );

        return (
            <div style={{ width: "100%", height: "100%" }}>
                {/* points and joining line */}
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="mandelbrotsample"
                    viewBox={viewBox}
                    transform="scale(1,-1)"
                    preserveAspectRatio="none">
                    <polyline points={polyLine} fill="none"></polyline>
                    {points}
                </svg>

                {/* tooltip */}
                <div className="mandelbrotsample-infobox" style={{ left: tooltipX, top: tooltipY }}>
                    <p>{MandelbrotSample.floatFormat(c.re)}</p>
                    <p>{MandelbrotSample.floatFormat(c.im)}i</p>
                    <hr></hr>
                    <p>
                        Z<sub>n</sub>
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
        viewBox: "-2 -2 4 4",
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
            <div ref={this.div} className="selector" onMouseDown={this.onMouseDown} onMouseUp={this.onMouseUp}>
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

    componentDidUpdate(prevProps, prevState) {
    }

    componentWillUnmount() {
        window.removeEventListener("mousemove", this.onMouseMove);
        window.removeEventListener("mouseup", this.onMouseUp);
    }

    boxGeometry(clickedPoint, currentPoint) {
        const rect = {
            left: clickedPoint.x,
            top: clickedPoint.y,
            width: currentPoint.x - clickedPoint.x,
            height: currentPoint.y - clickedPoint.y,
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

        // callback to parent
        if (onPointHover && !clickedPoint && !clipped) {
            const pointInViewBox = clientToViewBox(divRect, parseViewBox(viewBox), newCurrentPoint);
            onPointHover(newCurrentPoint, pointInViewBox);
        } else {
            onPointHover(null, null);
        }
    }

    onMouseDown(e) {
        // cancel hover
        const { onPointHover } = this.props;
        onPointHover && onPointHover(null);

        // set clicked point
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

                if (bg.width && bg.height) {
                    onBoxSelection(clientToViewBox(divRect, parseViewBox(viewBox), bg));
                }
            }
        }

        this.setState({ clickedPoint: null });
    }
}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(<App />);