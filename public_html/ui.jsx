"use strict";

/* viewbox defined by bottom left corner and a width and an height */
class ViewBox {
    constructor(box) {
        if (typeof box == "string") {
            const arr = box.split(/\s*[\s,]\s*/).map(x => Number.parseFloat(x));

            if (arr.length != 4) {
                throw new TypeError('four numbers expected for a view box string');
            }

            const [left, bottom, width, height] = arr;

            this.left = left;
            this.bottom = bottom;
            this.width = width;
            this.height = height;
        } else {
            this.left = box.left;
            this.bottom = box.bottom;
            this.width = box.width;
            this.height = box.height;
        }

        this.right = this.left + this.width;
        this.top = this.bottom + this.height;
    }

    toString() {
        return [this.left, this.bottom, this.width, this.height].map(x => x.toString()).join(' ');
    }

    // fit to a rectangle and return the containing new view box
    // fitting means setting the aspect ratio of the view to equal the box
    // by extending or contracting the bounding dimensions
    // fitting can be either: 'cover' or 'contain'
    // similar to object-fit css property
    fit(rect, fitting) {
        const thisAspectRatio = this.width / this.height;
        const rectAspectRatio = rect.width / rect.height;

        let dimensionToAdjust;
        if (fitting == "cover") {
            if (thisAspectRatio > rectAspectRatio) {
                dimensionToAdjust = "width";
            } else {
                dimensionToAdjust = "height";
            }
        } else if (fitting == "contain") {
            if (thisAspectRatio > rectAspectRatio) {
                dimensionToAdjust = "height";
            } else {
                dimensionToAdjust = "width";
            }
        } else {
            throw new ValueError("unrecognised fit value");
        }

        if (dimensionToAdjust == "width") {
            const width = this.height * rectAspectRatio;
            return new ViewBox({
                left: this.left + this.width / 2 - width / 2,
                bottom: this.bottom,
                height: this.height,
                width: width,
            });
        } else {
            const height = this.width / rectAspectRatio;
            return new ViewBox({
                left: this.left,
                bottom: this.bottom + this.height / 2 - height / 2,
                height: height,
                width: this.width,
            });
        }
    }

    /* transform values in a source rectangle coordinate system to the viewbox coordinate system */
    transform(rect, values, flipVertical = true) {
        const fx = this.width / rect.width;
        const fy = this.height / rect.height;
        const fv = flipVertical ? -1 : 1;

        const out = {};

        if (typeof values.x !== 'undefined') {
            out.x = this.left + (values.x - rect.left) * fx;
        }

        if (typeof values.left !== 'undefined') {
            out.left = this.left + (values.left - rect.left) * fx;
        }

        if (typeof values.right !== 'undefined') {
            out.right = this.left + (values.right - rect.left) * fx;
        }

        if (typeof values.y !== 'undefined') {
            out.y = this.top + (values.y - rect.top) * fy * fv;
        }

        if (typeof values.top !== 'undefined') {
            out.top = this.top + (values.top - rect.top) * fy * fv;
        }

        if (typeof values.bottom !== 'undefined') {
            out.bottom = this.top + (values.bottom - rect.top) * fy * fv;
        }

        if (typeof values.width !== 'undefined') {
            out.width = values.width * fx;
        }

        if (typeof values.height !== 'undefined') {
            out.height = values.height * fy;
        }

        if ([out.left, out.top, out.width, out.height].map(x => typeof x).every(x => x !== 'undefined')) {
            return new ViewBox(out);
        }

        return out;
    }
}

/* cached view box parsing */
const parseViewBox = _.memoize(box => (box instanceof ViewBox ? box : new ViewBox(box)));

/* set viewbox as specified in the URL for a viewbox */
function setURLViewBox(viewBox) {
    const url = new URL(window.location);
    const { left, bottom, width, height } = parseViewBox(viewBox);
    url.searchParams.set('x', left);
    url.searchParams.set('y', bottom);
    url.searchParams.set('dx', width);
    url.searchParams.set('dy', height);
    window.history.pushState({}, '', url);
}

/* get viewbox as specified in the URL, or return null */
function getURLViewBox() {
    const searchParams = new URL(window.location).searchParams;
    const [left, bottom, width, height] = ['x', 'y', 'dx', 'dy'].map(n => Number(searchParams.get(n)));

    // some value is missing?
    if ([left, bottom, width, height].some(isNaN)) {
        return null;
    }

    return new ViewBox({ left: left, bottom: bottom, width: width, height: height });
}

class App extends React.Component {
    static resetViewBox = "-2 -2 4 4";
    static defaultViewBox = "-2 -2 4 4";

    constructor(props) {
        super(props);

        this.state = {
            viewBox: this.getInitialViewBox(),
            containerDimensions: null,

            infoModalVisible: false,
            samplerVisible: false,
            samplerC: math.complex(0, 0),
        }

        this.container = React.createRef();
        this.onBoxSelection = this.onBoxSelection.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
        this.onInfoButtonClick = () => this.setState({ infoModalVisible: !this.state.infoModalVisible });
        this.onInfoCloseClick = () => this.setState({ infoModalVisible: false });

        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target == this.container.current) {
                    this.setDimensions();
                }
            }
        });
    }

    // outer render before dimensions are known
    render() {
        const { containerDimensions } = this.state;

        return (
            <div className="app" ref={this.container}>
                {containerDimensions && this.renderContent()}
            </div>
        );
    }

    // inner render when we know the container dimensions
    // and hence the aspect ratio
    renderContent() {
        const { viewBox, containerDimensions, infoModalVisible, samplerVisible, samplerC } = this.state;
        const showSampler = samplerVisible && (samplerC != null);

        // fit viewbox to the container
        const viewBoxFitted = parseViewBox(viewBox).fit(containerDimensions, 'contain').toString();

        return (
            <div>
                <MandelbrotSet
                    viewBox={viewBoxFitted}
                    resX={containerDimensions.width}
                    resY={containerDimensions.height} />

                <div style={{ display: (showSampler ? "" : "none") }}>
                    <Sampler
                        viewBox={viewBoxFitted}
                        c={samplerC}
                        maxIterations={100} />
                </div>

                <Selector
                    viewBox={viewBoxFitted}
                    onPointHover={this.onPointHover}
                    onBoxSelection={this.onBoxSelection} />

                <Navbar
                    sampleButtonActivated={samplerVisible}
                    workInProgress="1"
                    onSampleToggle={() => this.setState({ samplerVisible: !this.state.samplerVisible })}
                    onResetClick={() => this.setState({ viewBox: App.resetViewBox, infoModalVisible: false })}
                    onInfoButtonClick={this.onInfoButtonClick} />

                <InfoModal
                    visible={infoModalVisible}
                    onCloseClick={this.onInfoCloseClick} />
            </div>
        );
    }

    setDimensions() {
        const container = this.container.current;

        this.setState({
            containerDimensions: {
                width: container.offsetWidth,
                height: container.offsetHeight,
            },
        });
    }

    getInitialViewBox() {
        const vb = getURLViewBox();

        if (vb && vb.width && vb.height) {
            return vb.toString();
        }

        // fall back when nothing proper is specified
        return App.defaultViewBox;
    }

    componentDidMount() {
        this.resizeObserver.observe(this.container.current);
        this.setDimensions();
    }

    componentDidUpdate(prevProps, prevState) {
        const { containerDimensions } = this.state;

        if (!_.isEqual(prevState.containerDimensions, containerDimensions)) {
            containerDimensions && this.setDimensions();
        }

        // update the viewbox in the URL
        if (prevState.viewBox != this.state.viewBox) {
            setURLViewBox(this.state.viewBox);
        }
    }

    componentWillUnmount() {
        this.resizeObserver.disconnect();
    }

    onBoxSelection(subViewBox) {
        console.log("sub box selected", subViewBox);

        if (subViewBox != this.state.viewBox) {
            this.setState({ viewBox: subViewBox });
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
    static maxWorkerCount = 8;
    static frameThrottle = 5;
    static iterationsLimit = 4000;

    static defaultProps = {
        centerX: 0,
        centerY: 0,

        // pixels per unit length of imaginary plane
        resolution: 100,

        // canvas dimensions in pixels
        width: 400,
        height: 400,
    }

    constructor(props) {
        super(props);

        this.state = {
            workReference: null,
            frameCount: 0,
        }

        this.canvas = React.createRef();
        this.workers = null;

        // unprocessed frames of panels from workers
        this.frames = [];
    }

    render() {
        return (
            <canvas
                ref={this.canvas}
                width={this.props.width}
                height={this.props.height}
                className="mandelbrotset">
            </canvas>
        );
    }

    initiateCanvas() {
        const canvas = this.canvas.current;
        const context = canvas.getContext('2d');

        context.beginPath();
        context.fillStyle = "grey";
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    workerStart() {
        const canvas = this.canvas.current;
        const { centerX, centerY, resolution, width, height } = this.props;

        // exclusion checks
        if (!width || !height) {
            console.log("trivial view, cancelling calculation");
            this.setState({ workReference: null });
            return;
        }

        if (!this.workers || !this.workers.length) {
            console.error("no workers set up");
            this.setState({ workReference: null });
            return;
        }

        // unique work ID
        const workReference = Date.now() + "" + Math.floor(Math.random() * 1000000);
        console.debug(workReference, 'initiating workers');

        // set local model state
        this.setState({
            workReference: workReference,
            frameCount: 0,
        });

        // blank and size the canvas
        this.initiateCanvas();

        // initiate workers
        const workerCount = this.workers.length;

        this.workers.forEach((worker, workerIndex) => {
            worker.postMessage({
                command: 'point',
                workReference: `${workReference} ${workerIndex}`,
                pointX: centerX,
                pointY: centerY,
                resolution: resolution,
                width: width,
                height: height,
                step: workerCount,
                offset: workerIndex,
            });

            worker.postMessage({
                command: 'limit',
                frameLimit: MandelbrotSet.frameThrottle,
                iterationsLimit: MandelbrotSet.iterationsLimit,
                pause: false,
            });
        });
    }

    workerMessage(message) {
        this.frames.push(message.data);
        this.setState((state, props) => ({ frameCount: state.frameCount + 1 }));
    }

    processFrame(frame) {
        const context = this.canvas.current.getContext('2d');
        const [workReference, workerID] = frame.workReference.split(" ");

        // check frame is relevant
        if (workReference != this.state.workReference) {
            console.log(frame.workReference, 'frame ignored with mismatching reference');
            return;
        }

        // find coordinates of the center of the canvas
        const cx = Math.floor(this.props.width / 2);
        const cy = Math.floor(this.props.height / 2);

        // render each panel to canvas
        frame.snaps.forEach(snap => {
            const { bitmap, panelX, panelY, x, y } = snap;

            // coordinates on the canvas to draw this panel
            const canvasX = cx + x;
            const canvasY = cy + y;
            context.drawImage(bitmap, canvasX, canvasY);
        });

        context.beginPath();
        context.fillStyle = "blue";
        context.fillRect(cx - 5, cy - 5, 10, 10);

        // update throttle limits
        this.workers[workerID].postMessage({
            command: 'limit',
            frameLimit: frame.index + MandelbrotSet.frameThrottle,
            iterationsLimit: MandelbrotSet.iterationsLimit,
        });
    }

    processFrames() {
        const frames = this.frames;

        // new frames to new buffer
        this.frames = [];

        // process each frame in iteration order for smoothness
        _.sortBy(frames, f => f.iteration).forEach(f => this.processFrame(f));
    }

    componentDidMount() {
        const workerCount = Math.min(navigator.hardwareConcurrency || 1, MandelbrotSet.maxWorkerCount);
        this.workers = []

        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker('worker.js');
            worker.onmessage = this.workerMessage.bind(this);
            this.workers.push(worker);
        }

        this.workerStart();
    }

    componentDidUpdate(prevProps, prevState) {
        const { centerX, centerY, resolution, width, height } = this.props;
        const { frameCount } = this.state;

        // new model required?
        const modelChanged = centerX != prevProps.centerX
            || centerY != prevProps.centerY
            || resolution != prevProps.resolution
            || width != prevProps.width
            || height != prevProps.height;

        if (modelChanged) {
            this.workerStart();
        } else if (frameCount != prevState.frameCount) {
            this.processFrames();
        }
    }

    componentWillUnmount() {
        this.workers && this.workers.forEach(w => w.terminate());
        this.workers = null;
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
        const escaped = !sample.undetermined && sample.escapeAge;
        const escapedClass = escaped ? "sampler-escaped" : "sampler-bounded";

        const polyLine = sample.zi.map(zi => `${zi.re},${zi.im}`).join(' ');
        const pointSize = viewBox.width / 80;
        const points = sample.zi.map((zi, i) =>
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
    // the box has the usual rectangle coordinate system (vertical increasing downwards)
    boxGeometry(clickedPoint, currentPoint) {
        const rect = {
            left: clickedPoint.x,
            top: clickedPoint.y,
            width: currentPoint.x - clickedPoint.x,
            height: currentPoint.y - clickedPoint.y,
        }

        // correct inside out rectangle
        if (rect.width < 0) {
            rect.left = rect.left + rect.width;
            rect.width *= -1;
        }

        if (rect.height < 0) {
            rect.top = rect.top + rect.height;
            rect.height *= -1;
        }

        rect.right = rect.left + rect.width;
        rect.bottom = rect.top + rect.height;
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
            const viewBoxPoint = parseViewBox(viewBox).transform(divRect, { x: clientX, y: clientY });
            onPointHover(viewBoxPoint);
        }
    }

    onMouseDown(e) {
        if (e.button == 0) {
            const divRect = this.div.current.getBoundingClientRect();
            this.setState({ clickedPoint: { x: e.clientX - divRect.left, y: e.clientY - divRect.top } });
        }
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
                const bgBox = { left: 0, top: 0, width: divRect.width, height: divRect.height };

                if (bg.width > 10 && bg.height > 10) {
                    const subViewRect = parseViewBox(viewBox).transform(bgBox, bg);
                    const subViewBox = parseViewBox(subViewRect).toString();
                    onBoxSelection(subViewBox);
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
            <div className="navbar">
                <div className="navbar-item"
                    onMouseDown={() => this.setState({ highlightResetButton: true })}
                    onMouseUp={() => this.setState({ highlightResetButton: false })}
                    onClick={this.props.onResetClick}>
                    {/* house icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
                        <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
                    </svg>
                </div>
                <div className={this.props.sampleButtonActivated ? "navbar-item navbar-item-active" : "navbar-item"}
                    onClick={this.props.onSampleToggle}>
                    {/* cursor icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z" />
                    </svg>
                </div>
                <div className="navbar-item">
                    <div className={this.props.workInProgress ? "navbar-icon-working" : ""}>
                        {/* fan icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                            <path d="M10 3c0 1.313-.304 2.508-.8 3.4a1.991 1.991 0 0 0-1.484-.38c-.28-.982-.91-2.04-1.838-2.969a8.368 8.368 0 0 0-.491-.454A5.976 5.976 0 0 1 8 2c.691 0 1.355.117 1.973.332.018.219.027.442.027.668Zm0 5c0 .073-.004.146-.012.217 1.018-.019 2.2-.353 3.331-1.006a8.39 8.39 0 0 0 .57-.361 6.004 6.004 0 0 0-2.53-3.823 9.02 9.02 0 0 1-.145.64c-.34 1.269-.944 2.346-1.656 3.079.277.343.442.78.442 1.254Zm-.137.728a2.007 2.007 0 0 1-1.07 1.109c.525.87 1.405 1.725 2.535 2.377.2.116.402.222.605.317a5.986 5.986 0 0 0 2.053-4.111c-.208.073-.421.14-.641.199-1.264.339-2.493.356-3.482.11ZM8 10c-.45 0-.866-.149-1.2-.4-.494.89-.796 2.082-.796 3.391 0 .23.01.457.027.678A5.99 5.99 0 0 0 8 14c.94 0 1.83-.216 2.623-.602a8.359 8.359 0 0 1-.497-.458c-.925-.926-1.555-1.981-1.836-2.96-.094.013-.191.02-.29.02ZM6 8c0-.08.005-.16.014-.239-1.02.017-2.205.351-3.34 1.007a8.366 8.366 0 0 0-.568.359 6.003 6.003 0 0 0 2.525 3.839 8.37 8.37 0 0 1 .148-.653c.34-1.267.94-2.342 1.65-3.075A1.988 1.988 0 0 1 6 8Zm-3.347-.632c1.267-.34 2.498-.355 3.488-.107.196-.494.583-.89 1.07-1.1-.524-.874-1.406-1.733-2.541-2.388a8.363 8.363 0 0 0-.594-.312 5.987 5.987 0 0 0-2.06 4.106c.206-.074.418-.14.637-.199ZM8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
                            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14Zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16Z" />
                        </svg>
                    </div>
                </div>
                <div className="navbar-item"
                    onClick={() => this.props.onInfoButtonClick()}>
                    {/* info icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="m9.708 6.075-3.024.379-.108.502.595.108c.387.093.464.232.38.619l-.975 4.577c-.255 1.183.14 1.74 1.067 1.74.72 0 1.554-.332 1.933-.789l.116-.549c-.263.232-.65.325-.905.325-.363 0-.494-.255-.402-.704l1.323-6.208Zm.091-2.755a1.32 1.32 0 1 1-2.64 0 1.32 1.32 0 0 1 2.64 0Z" />
                    </svg>
                </div>
            </div>

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
