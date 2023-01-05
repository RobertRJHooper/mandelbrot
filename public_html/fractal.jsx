"use strict";

// todo: memoize this for speed
function parseViewBox(s) {
    return s.split(/\s*[\s,]\s*/).map(x => Number.parseFloat(x));
}

class App extends React.Component {
    static baseViewBox = "-2 -2 4 4"
    static defaultProps = {
    }

    constructor(props) {
        super(props);

        this.state = {
            viewBox: App.baseViewBox,
            traceToggle: true,
            traceZ: null,
        }

        this.onBoxSelection = this.onBoxSelection.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
    }

    render() {
        const {viewBox, traceToggle, traceZ} = this.state;
        const showTrace = traceToggle && traceZ !== null;

        return (
            <div>
                <div style={{ display: "block", zIndex: 1, position: "absolute", right: 0 }}>
                    <Navbar
                        traceToggle={traceToggle}
                        onTraceToggle={() => this.setState((state, props) => ({ traceToggle: !state.traceToggle }))}
                        onResetClick={() => this.setState({ viewBox: App.baseViewBox })} />
                </div>
                <div className="app-layer" style={{ zIndex: 0 }}>
                    <Selector viewBox={viewBox} onPointHover={this.onPointHover} onBoxSelection={this.onBoxSelection} />
                </div>
                <div className="app-layer" style={{ zIndex: -1, visibility: (showTrace ? "visible" : "hidden") }}>
                    <MandelbrotSample viewBox={viewBox} z={traceZ} />
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

    onPointHover(point) {
        const traceZ = point && math.complex(point.x, point.y);

        if (this.state.traceZ != traceZ) {
            this.setState({ traceZ: traceZ });
        }
    }
}

class Navbar extends React.Component {
    static defaultProps = {
        traceToggle: true,
        showInfoToggle: true,
        iteration: null,
        currentPoint: null,

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
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
                        <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
                    </svg>
                </li>
                <li className={this.props.traceToggle ? "navbar-li navbar-li-active" : "navbar-li"}
                    onClick={this.props.onTraceToggle}>
                    {/* zigzag icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path fillRule="evenodd" d="M6 2a.5.5 0 0 1 .47.33L10 12.036l1.53-4.208A.5.5 0 0 1 12 7.5h3.5a.5.5 0 0 1 0 1h-3.15l-1.88 5.17a.5.5 0 0 1-.94 0L6 3.964 4.47 8.171A.5.5 0 0 1 4 8.5H.5a.5.5 0 0 1 0-1h3.15l1.88-5.17A.5.5 0 0 1 6 2Z" />
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
    }

    constructor(props) {
        super(props);

        this.state = {
            modelID: null,
            iteration: null,
            image: null,
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
        const [minRe, minIm, viewWidth, viewHeight] = parseViewBox(viewBox);

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
            minIm: minIm,
            minRe: minRe,
            viewHeight: viewHeight,
            viewWidth: viewWidth,
            width: width,
            height: height,
            maxIterations: maxIterations,
            frameLimit: frameThrottle,
        });
    }

    workerMessage(message) {
        const { modelID, iteration, image, frameCount, frameLimit } = message.data;

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
                image: image,
            };
        });
    }

    paintImage() {
        const image = this.state.image;

        if (!image) {
            return;
        }

        const context = this.canvas.current.getContext('2d', { alpha: false });
        context.putImageData(image, 0, 0);
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
        this.onWindowMouseUp = this.onWindowMouseUp.bind(this);
    }



    render() {
        const { clickedPoint, currentPoint } = this.state;
        const box = clickedPoint && currentPoint && this.boxGeometry(clickedPoint, currentPoint);
        const boxStyle = box ? { ...box, visibility: "visible" } : { visibility: "hidden" };

        return (
            <div ref={this.div} className="selector" onMouseDown={this.onMouseDown} onMouseUp={this.onMouseUp}>
                <div className="selector-box" style={boxStyle}>
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

    clientToFrameCoorindates(p) {
        const divRect = this.div.current.getBoundingClientRect();
        return { x: p.x - divRect.left, y: p.y - divRect.top };
    }

    frameToViewBox(r) {
        const divRect = this.div.current.getBoundingClientRect();
        const [viewBoxLeft, viewBoxBottom, viewBoxWidth, viewBoxHeight] = parseViewBox(this.props.viewBox);

        if (!divRect.width || !divRect.height) {
            return;
        }

        const fx = viewBoxWidth / divRect.width;
        const fy = viewBoxHeight / divRect.height;

        // construct results
        const out = {}

        if (r.x !== undefined) { out.x = viewBoxLeft + r.x * fx; }
        if (r.left !== undefined) { out.left = viewBoxLeft + r.left * fx; }
        if (r.right !== undefined) { out.right = viewBoxLeft + r.right * fx; }
        if (r.y !== undefined) { out.y = viewBoxBottom + viewBoxHeight - r.y * fy; }
        if (r.top !== undefined) { out.top = viewBoxBottom + viewBoxHeight - r.top * fy; }
        if (r.bottom !== undefined) { out.top = viewBoxBottom + viewBoxHeight - r.bottom * fy; }
        if (r.width !== undefined) { out.width = r.width * fx }
        if (r.height !== undefined) { out.height = r.height * fy }

        return out;
    }

    onMouseMove(e) {
        const div = this.div.current;
        const onPointHover = this.props.onPointHover;
        const { currentPoint, clickedPoint } = this.state;

        if (!div) {
            return;
        }

        // clip position to the app frame
        const clientX = Math.min(Math.max(div.clientLeft, e.clientX), div.clientLeft + div.clientWidth);
        const clientY = Math.min(Math.max(div.clientTop, e.clientY), div.clientTop + div.clientHeight);
        const clipped = clientX != e.clientX || clientY != e.clientY;

        // convert to app frame coordinates
        const newCurrentPoint = this.clientToFrameCoorindates({ x: clientX, y: clientY });
        const pointMoved = !currentPoint || (newCurrentPoint.x != currentPoint.x) || (newCurrentPoint.y != currentPoint.y);

        // report new state to this component
        if (pointMoved) {
            this.setState({ currentPoint: newCurrentPoint });
        }

        // callback to parent
        if (onPointHover && !clickedPoint && !clipped) {
            onPointHover(this.frameToViewBox(newCurrentPoint));
        } else {
            onPointHover(null);
        }
    }

    onMouseDown(e) {
        const onPointHover = this.props.onPointHover;
        onPointHover && onPointHover(null);
        this.setState({ clickedPoint: this.clientToFrameCoorindates({ x: e.clientX, y: e.clientY }) });
    }

    onMouseUp(e) {
        const { currentPoint, clickedPoint } = this.state;
        const onBoxSelection = this.props.onBoxSelection;

        if (onBoxSelection && clickedPoint && currentPoint) {
            const bg = this.boxGeometry(clickedPoint, currentPoint);
            bg.width && bg.height && onBoxSelection(this.frameToViewBox(bg));
        }

        this.setState({ clickedPoint: null });
    }

    onWindowMouseUp(e) {

    }

}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(<App />);
