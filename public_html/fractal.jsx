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
    static defaultViewBox = "-2 -2 4 4"

    constructor(props) {
        super(props);

        this.state = {
            viewBox: App.defaultViewBox,
            traceToggle: true,
            traceZ: 0,
        }

        this.onBoxSelection = this.onBoxSelection.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
    }

    render() {
        const { viewBox, traceToggle, traceZ } = this.state;
        const showTrace = traceToggle && traceZ !== null;

        return (
            <div>
                <div className="app-info" style={{ zIndex: 1 }}>
                    <InfoBar
                        hoverZ={this.state.traceZ}
                        iteration={this.state.iteration} />
                </div>
                <div className="app-nav" style={{ zIndex: 1 }}>
                    <Navbar
                        traceToggle={traceToggle}
                        onTraceToggle={() => this.setState((state, props) => ({ traceToggle: !state.traceToggle }))}
                        onResetClick={() => this.setState({ viewBox: App.defaultViewBox })} />
                </div>
                <div className="app-layer" style={{ zIndex: 0 }}>
                    <Selector
                        viewBox={viewBox}
                        onPointHover={this.onPointHover}
                        onBoxSelection={this.onBoxSelection} />
                </div>
                <div className="app-layer" style={{ zIndex: -1, visibility: (showTrace ? "visible" : "hidden") }}>
                    <MandelbrotSample
                        viewBox={viewBox}
                        z={traceZ} />
                </div>
                <div className="app-layer" style={{ zIndex: -2 }}>
                    <MandelbrotSet
                        viewBox={viewBox}
                        onStatusUpdate={(status) => this.setState(status)} />
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

    onPointHover(point) {
        const traceZ = point && math.complex(point.x, point.y);

        if (this.state.traceZ != traceZ) {
            this.setState({ traceZ: traceZ });
        }
    }
}
class InfoBar extends React.Component {
    static floatFormat = new Intl.NumberFormat(
        "us-en",
        {
            signDisplay: 'always',
            minimumFractionDigits: 15,
            maximumFractionDigits: 15
        }).format;

    static defaultProps = {
        hoverZ: math.complex(0, 0),
        iteration: 0,
    }

    constructor(props) {
        super(props);
    }

    render() {
        return (
            <div className="infobar">
                <span>
                    Iterations:
                    {this.props.iteration}
                    Hover point: z = 
                    {InfoBar.floatFormat(math.complex(this.props.hoverZ).re)}
                    {InfoBar.floatFormat(math.complex(this.props.hoverZ).im)}i
                </span>
            </div>
        );
    }
}

class Navbar extends React.Component {
    static defaultProps = {
        traceToggle: true,
        showInfoToggle: true,

        currentZ: math.complex(0, 0),
        iteration: 0,

        onTraceToggle: null,
        onResetClick: null,
    }

    constructor(props) {
        super(props);

        this.state = {
            highlightResetButton: false,
        }
    }

    render() {
        return (

            <ul className="navbar">
                <li className={this.state.highlightResetButton ? "navbar-li navbar-li-active-on-hover" : "navbar-li"}
                    onMouseDown={() => this.setState({ highlightResetButton: true })}
                    onMouseUp={() => this.setState({ highlightResetButton: false })}
                    onClick={this.props.onResetClick}>
                    {/* house icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
                        <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
                    </svg>
                </li>
                <li className={this.props.traceToggle ? "navbar-li navbar-li-active" : "navbar-li"}
                    onClick={this.props.onTraceToggle}>
                    {/* zigzag icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path fillRule="evenodd" d="M6 2a.5.5 0 0 1 .47.33L10 12.036l1.53-4.208A.5.5 0 0 1 12 7.5h3.5a.5.5 0 0 1 0 1h-3.15l-1.88 5.17a.5.5 0 0 1-.94 0L6 3.964 4.47 8.171A.5.5 0 0 1 4 8.5H.5a.5.5 0 0 1 0-1h3.15l1.88-5.17A.5.5 0 0 1 6 2Z" />
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
        width: 800,
        height: 600,
        maxIterations: 1000,
        frameThrottle: 5,
        onStatusUpdate: null,
    }

    constructor(props) {
        super(props);

        this.state = {
            modelID: null,
            iteration: null,
            bitmap: null,
        }

        this.canvas = React.createRef();
        this.worker = null;
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

    startModel() {
        const { viewBox, width, height, maxIterations, frameThrottle } = this.props;

        // bail if it's a trivial canvas
        if (width < 1 || height < 1) {
            return;
        }

        // create a unique model id
        const modelID = Date.now() + "" + Math.floor(Math.random() * 1000000);
        console.log('starting model', modelID);

        // parse viewbox
        const vb = parseViewBox(viewBox);

        // save initial model state
        this.setState({
            modelID: modelID,
            iteration: -1,
            image: null,
        });

        // start calculations on worker
        this.worker.postMessage({
            command: 'init',
            modelID: modelID,
            viewTopLeft: math.complex(vb.left, vb.top),
            viewWidth: vb.width,
            viewHeight: vb.height,
            width: width, // calculation grid dimensions
            height: height,
            maxIterations: maxIterations,
            frameLimit: frameThrottle,
        });
    }

    workerMessage(message) {
        const { modelID, iteration, bitmap, frameCount, frameLimit } = message.data;

        // status callback to parent
        const { onStatusUpdate } = this.props;
        onStatusUpdate && onStatusUpdate({ iteration: iteration });

        // component state
        this.setState(function (state, props) {
            if (state.modelID != modelID) {
                console.debug('orphan message from worker', modelID);
                return {};
            }

            // issue update to worker for frame limit
            const newFrameLimit = frameCount + props.frameThrottle;
            this.worker.postMessage({ command: 'frameLimit', modelID: modelID, frameLimit: newFrameLimit });

            // don't display out of sequence frames
            if (state.iteration >= iteration) {
                console.debug('late frame returned', modelID, iteration);
                return {};
            }

            // set state
            return {
                iteration: iteration,
                frameCount: frameCount,
                bitmap: bitmap,
            };
        });
    }

    paintImage() {
        const bitmap = this.state.bitmap;

        if (!bitmap) {
            return;
        }

        const context = this.canvas.current.getContext('2d', { alpha: false });
        context.drawImage(bitmap, 0, 0);
    }

    componentDidMount() {
        this.worker = new Worker('worker.js');
        this.worker.onmessage = this.workerMessage.bind(this);
        this.startModel();
    }

    componentDidUpdate(prevProps, prevState) {
        const cp = this.props;
        const pp = prevProps;

        if (cp.viewBox != pp.viewBox
            || cp.width != pp.width
            || cp.height != pp.height
            || cp.maxIterations != pp.maxIterations) {
            this.startModel();
        } else if (this.state.iteration != prevState.iteration) {
            this.paintImage();
        }
    }

    componentWillUnmount() {
        this.worker && this.worker.terminate();
    }
}

class MandelbrotSample extends React.Component {
    static defaultProps = {
        viewBox: "-2 -2 4 4",
        z: "0.5 + 0.2i",
        maxIterations: 100,
    }

    constructor(props) {
        super(props);
    }

    render() {
        const { z, maxIterations } = this.props;

        // get iteration of points
        // should be quick enough to be in here in render
        const sample = mbSample(math.complex(z), maxIterations);
        const points = sample.zn.map(zi => `${zi.re},${zi.im}`).join(' ');

        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                className="mandelbrotsample"
                viewBox={this.props.viewBox}
                transform="scale(1,-1)"
                preserveAspectRatio="none">
                <defs>
                    <marker
                        id="mandelbrotsample-marker-start"
                        className="mandelbrotsample-marker-start"
                        viewBox="-5 -5 10 10"
                        markerWidth="4"
                        markerHeight="4">
                        <circle r="5" />
                    </marker>
                    <marker
                        id="mandelbrotsample-marker"
                        className="mandelbrotsample-marker"
                        viewBox="-5 -5 10 10"
                        markerWidth="4"
                        markerHeight="4">
                        <circle r="5" />
                    </marker>
                </defs>
                <polyline
                    points={points}
                    fill="none"
                    markerStart="url(#mandelbrotsample-marker-start)"
                    markerMid="url(#mandelbrotsample-marker)"
                    markerEnd="url(#mandelbrotsample-marker)" />
            </svg>
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

    clientToViewBox(values) {
        const frame = this.div.current.getBoundingClientRect();
        return;
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
            onPointHover(pointInViewBox);
        } else {
            onPointHover(null);
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
