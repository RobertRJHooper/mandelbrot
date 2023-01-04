"use strict";

class MandelbrotSet extends React.Component {
    static defaultProps = {
        center: "-0.5 + 0i",
        resolution: "auto",
        maxIterations: 1000,
        width: 800,
        height: 600,
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
        const { center, resolution, maxIterations, width, height } = this.props;

        // bail if it's a trivial canvas
        if (width < 1 || height < 1) {
            return;
        }

        // create a unique model id
        const modelID = Date.now() + "" + Math.floor(Math.random() * 1000000);

        // parse complex numbers
        const center_ = math.complex(center);
        let resolution_ = 0;

        // pick resolution to fit the full mandelbrot set
        if (resolution == "auto") {
            const rx = 3.2 / height;
            const ry = 4.0 / width;
            resolution_ = Math.max(rx, ry);
        } else {
            resolution_ = resolution;
        }

        // save initial model state
        this.setState({
            modelID: modelID,
            iteration: -1,
            image: null,
        });

        // diagnostics
        console.debug('running model', modelID);

        // start calculations on worker
        this.worker.postMessage({
            modelID: modelID,
            center: center_,
            resolution: resolution_,
            width: width,
            height: height,
            maxIterations: maxIterations,
        });
    }

    workerMessage(message) {
        this.setState(function (state, props) {
            if (state.modelID != message.data.modelID) {
                console.debug('orphan message from worker', message.data.modelID);
                return {};
            }

            if (state.iteration >= message.data.iteration) {
                console.debug('late frame returned', message.data.modelID, message.data.iteration);
                return {};
            }

            return {
                iteration: message.data.iteration,
                image: message.data.image,
            };
        });
    }

    componentDidMount() {
        this.worker = new Worker('worker.js');
        this.worker.onmessage = this.workerMessage.bind(this);
        this.startModel();
    }

    componentDidUpdate(prevProps, prevState) {
        if (this.props.center != prevProps.center
            || this.props.resolution != prevProps.resolution
            || this.props.maxIterations != prevProps.maxIterations
            || this.props.width != prevProps.width
            || this.props.height != prevProps.height) {
            this.startModel();
        } else if (this.state.iteration != prevState.iteration) {
            const image = this.state.image;

            if (image) {
                const context = this.canvas.current.getContext('2d', { alpha: false });
                context.putImageData(this.state.image, 0, 0);
            }
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
                viewBox={this.props.viewBox}>
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

    componentDidMount() {
    }

    componentDidUpdate(prevProps, prevState) {
    }

    componentWillUnmount() {
    }
}


const root = ReactDOM.createRoot(document.getElementById('mbs'));
//root.render(<MandelbrotSet />);
root.render(<MandelbrotSample />);
