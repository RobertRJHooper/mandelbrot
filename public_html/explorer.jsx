"use strict";

class ModelCanvas extends React.Component {
    static defaultProps = {
        center: "-0.5 + 0i",
        resolution: 'auto',
        max_iterations: 1000,
    }

    static runModelDelay = 400;

    constructor(props) {
        super(props);

        this.state = {
            width: 0,
            height: 0,
        }

        // placeholder for the model, id, latest image
        this.modelpack = null;
        this.runModelTimeout = null;

        // setup worker listener to receive images
        this.worker = new Worker('worker.js');
        this.worker.onmessage = (message) => {
            const modelpack = this.modelpack;

            if (modelpack && modelpack.id == message.data.id) {
                modelpack.image = message.data.image;
            } else {
                console.debug('orphan message from worker', message.data.id);
            }
        };

        // other       
        this.canvas = React.createRef();
        this.resizeObserver = new ResizeObserver(this.resizeObserved.bind(this));
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    render() {
        return (
            <canvas
                ref={this.canvas}
                width={this.state.width}
                height={this.state.height}
                onMouseMove={this.onMouseMove}
                onMouseDown={this.onMouseDown}
                onMouseUp={this.onMouseUp}
                style={{ position: "absolute", width: "100%", height: "100%" }}>
            </canvas>
        );
    }

    // if the model/canvas resolution mismatches the element dimensions
    // then update model through the state update
    // returns true if an update occurred
    updateGeometryState() {
        const { width, height } = this.state;
        const rect = this.canvas.current.getBoundingClientRect();

        if (width != rect.width || height != rect.height) {
            this.setState({ width: rect.width, height: rect.height });
            return true;
        }

        return false;
    }

    resizeObserved(entries, observer) {
        const canvas = this.canvas.current;

        for (const entry of entries) {
            if (entry.target == canvas) {
                this.updateGeometryState();
            } else {
                observer.unobserve(entry);
            }
        }
    }

    runModel() {
        const { center, resolution, max_iterations } = this.props;
        const { width, height } = this.state;
        const canvas = this.canvas.current;

        // bail if it's a trivial canvas
        if (width < 1 || height < 1) {
            return;
        }

        // parse complex numbers
        const center_ = math.complex(center);
        let resolution_ = 0;

        if (resolution == "auto") {
            // pick resolution to fit the full mandelbrot set in
            const rx = 3.2 / height;
            const ry = 4.0 / width;
            resolution_ = Math.max(rx, ry);
        } else {
            resolution_ = resolution;
        }

        // create model and send to worker
        const modelpack = {
            id: Date.now(),
            model: new MandelbrotSetModel(center_, resolution_, width, height, max_iterations),
            image: null,
        }

        // debug
        console.debug('running model', modelpack.id);

        // start calculations on worker
        this.worker.postMessage({
            id: modelpack.id,
            model: modelpack.model,
            center: center_,
            resolution: resolution_,
            width: width,
            height: height,
            max_iterations: max_iterations,
        });

        // start the local animation loop
        this.modelpack = modelpack;
        this.animationLoop(modelpack);
    }

    // run model after a delay to throttle calls
    // delay start of the model until renders have settled
    // this means resizing the window etc doesn't generate alot of
    // model initialisations and then cancels
    runModelDelayed() {
        clearTimeout(this.runModelTimeout);
        this.runModelTimeout = setTimeout(this.runModel.bind(this), ModelCanvas.runModelDelay);
    }

    // loop that draws a new image if one is available
    animationLoop(modelpack) {
        const current_modelpack = this.modelpack;

        // close the loop when the model pack has expired
        if (!current_modelpack || modelpack.id != current_modelpack.id) {
            return;
        }

        // extract the image and render
        const image = modelpack.image;
        modelpack.image = null;

        if (image) {
            const context = this.canvas.current.getContext('2d');
            context.putImageData(image, 0, 0);
        }

        // loop
        requestAnimationFrame(() => this.animationLoop(modelpack));
    }

    componentDidMount() {
        if (!this.updateGeometryState()) {
            this.runModelDelayed();
        }
        this.resizeObserver.observe(this.canvas.current);
    }

    componentDidUpdate(prevProps, prevState) {
        if (!this.updateGeometryState()) {
            this.runModelDelayed();
        }
    }

    componentWillUnmount() {
        this.modelpack = null;
        this.resizeObserver.disconnect();
    }

    onMouseMove(e) {
        const { clientX, clientY } = e;

        if (0 && this.scheduler) {
            const z = this.scheduler.model.coordinatesToValue(clientX, clientY);
            console.log(clientX, clientY, z);
        }
        //console.log('mouse move',);
    }

    onMouseDown(e) {
        console.log('mouse down', e);
    }

    onMouseUp(e) {
        console.log('mouse up', e);
    }
}

const root = ReactDOM.createRoot(document.getElementById('mainCanvas'));
root.render(<ModelCanvas />);
