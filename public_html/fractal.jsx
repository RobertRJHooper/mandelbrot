"use strict";

function parseViewBox(s) {
    return s.split(/\s+,?\s*/).map(x => Number.parseFloat(x));
}

class App extends React.Component {
    static defaultProps = {
    }

    constructor(props) {
        super(props);

        this.state = {
            viewBox: "-2 -2 4 4",
            cursorZ: "10",
        }

        this.selectionCallback = this.selectionCallback.bind(this);
    }

    render() {
        const viewBox = this.props.viewBox;

        return (
            <div>
                <div className="app-layer" style={{ zIndex: -2 }}>
                    <MandelbrotSet viewBox={viewBox} />
                </div>
                <div className="app-layer" style={{ zIndex: -1 }}>
                    <MandelbrotSample viewBox={viewBox} z={this.state.cursorZ} />
                </div>
                <div className="app-layer" style={{ zIndex: 0 }}>
                    <Selector viewBox={viewBox} callback={this.selectionCallback} />
                </div>
            </div>
        );
    }

    selectionCallback(selection) {
        this.setState({ cursorZ: math.complex(selection.cursorX, selection.cursorY) });
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
        callback: null,
        disabled: true,
    }

    constructor(props) {
        super(props);

        this.state = {
            cursorX: 0,
            cursorY: 0,
            selecting: false,

            boxTop: 0,
            boxLeft: 0,
            width: 0,
            height: 0,
        }

        this.div = React.createRef();
        this.onMouseMove = this.onMouseMove.bind(this);
    }

    render() {
        return (
            <div ref={this.div} className="selector" onMouseMove={this.onMouseMove}>
                <div>

                </div>
            </div>
        );
    }

    componentDidMount() {
    }

    componentDidUpdate(prevProps, prevState) {
        const ps = prevState;
        const cs = this.state;

        if (ps.cursorX != cs.cursorX || ps.cursorY != cs.cursorY) {
            this.props.callback && this.props.callback({ ...this.state });
        }
    }

    componentWillUnmount() {
    }

    // covert client coordinates to viewbox
    clientToViewBox(x, y) {
        const r = this.div.current.getBoundingClientRect();

        if (!r.width || !r.height) {
            return;
        }

        const fx = (x - r.left) / r.width;
        const fy = (r.bottom - y) / r.height;
        const [left, bottom, width, height] = parseViewBox(this.props.viewBox);
        return { x: left + width * fx, y: bottom + height * fy };
    }

    // update state with view box mouse coordinates
    onMouseMove(e) {
        const point = this.clientToViewBox(e.clientX, e.clientY);

        if (point) {
            this.setState({ cursorX: point.x, cursorY: point.y });
        }
    }

}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(<App />);
