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
                style={{objectFit: "cover", width: "100%", height: "100%"}}>
            </canvas>
        );
    }

    startModel() {
        const { center, resolution, maxIterations, width, height } = this.props;
        const canvas = this.canvas.current;

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

const root = ReactDOM.createRoot(document.getElementById('mbs'));
root.render(<MandelbrotSet />);
