"use strict";

/* get viewbox as specified in the URL, or return null if not valid */
function pullURLParams() {
    const url = new URL(window.location);
    const searchParams = url.searchParams;

    // retrieve from URL
    const re = searchParams.get('re');
    const im = searchParams.get('im');
    const zoom = searchParams.get('zoom');
    const precision = searchParams.get('precision');

    // validate all as floating point numbers
    const validator = /^[-+]?\d+\.?\d*$/;

    for (const value of [re, im, zoom, precision]) {
        if (typeof (value) == 'undefined' || value === null)
            return;

        if (!validator.test(value)) {
            console.error('bad parameter in URL', value);
            return;
        }
    }

    // check zoom is positive
    if (zoom.startsWith('-')) {
        console.error('zoom must be positive');
        return;
    }

    // check precision is positive
    if (precision.startsWith('-')) {
        console.error('precision must be positive');
        return;
    }

    return {
        center: { re: re, im: im },
        zoom: zoom,
        precision: Math.round(Number(precision)),
    };
}

/* push the view to the URL if it's not already there */
function pushURLParams(center, zoom, precision) {
    const url = new URL(window.location);
    const searchParams = url.searchParams;
    searchParams.set('re', center.re);
    searchParams.set('im', center.im);
    searchParams.set('zoom', zoom);
    searchParams.set('precision', precision);
    window.history.pushState({}, '', url);
}

class App extends React.Component {
    static defaultViewState = {

        // high precision numbers are stored as strings in the UI
        center: { re: "0", im: "0" },

        // zoom is the number of pixels per unit in the imaginary plane
        zoom: "200",

        // number of significant figures that high precision number have
        // for low values, regular Javascript floats are used
        // for high values, custom (slow) Decimal.js objects are used
        precision: 15,

        // pinch zoom modifier to the magnification
        // This is reset and baked into center
        // at the end of the pinch
        postZoom: 1,
    };

    constructor(props) {
        super(props);

        this.state = {
            ...App.defaultViewState,
            ...pullURLParams() || {},

            // pixel dimensions of the canvas display
            width: 0,
            height: 0,

            // What does panning with the mouse or touch pad do
            // 'pan' - move the center point around
            // or 
            // 'box-select' - draw a box and zoom into that box on release
            mouseMode: 'pan',

            // single (complex) point runout sample display
            sample: null,
            sampleVisible: false,

            // popup info box
            infoModalVisible: false,
        }

        // keep track of container dimensions
        this.container = React.createRef();

        // external state observation
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target == this.container.current) this.pullContainerDimensions();
            }
        });
        this.pushStateToURL = this.pushStateToURL.bind(this);

        // callbacks for child elements
        this.onBoxSelect = this.onBoxSelect.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
        this.onPan = this.onPan.bind(this);
        this.onZoomChange = this.onZoomChange.bind(this);
        this.onZoomComplete = this.onZoomComplete.bind(this);

        // pushing zoom back to URL on updates with debounce throttling
        this.pushStateToURLDebounced = _.debounce(this.pushStateToURL.bind(this), 1000);
    }

    /* pull the container dimensions into the state */
    pullContainerDimensions() {
        const container = this.container.current;

        this.setState({
            width: container.offsetWidth,
            height: container.offsetHeight,
        });
    }

    pullStateFromURL() {
        const current = pullURLParams();
        current && this.setState(current);
    }

    pushStateToURL() {
        const { center, zoom, precision } = this.state;
        const current = pullURLParams();

        // look for changes
        const changed = !current
            || current.center.re != center.re
            || current.center.im != center.im
            || current.zoom != zoom
            || current.precision != precision;

        // update URL on change
        if (changed) pushURLParams(center, zoom, precision);
    }

    // outer render before dimensions are known
    render() {
        const { width, height } = this.state;

        return (
            <div className="app" ref={this.container}>
                {width && height && this.renderContent()}
            </div>
        );
    }

    // inner render when we know the container dimensions
    renderContent() {
        const { center, zoom, precision, postZoom, width, height } = this.state;

        return (
            <div>
                <MandelbrotSet
                    center={center} zoom={zoom} precision={precision}
                    postZoom={postZoom}
                    canvasWidth={width}
                    canvasHeight={height}
                />

                {this.state.sampleVisible && (postZoom == 1) &&
                    <SampleDisplay
                        center={center} zoom={zoom} precision={precision}
                        width={width}
                        height={height}
                        sample={this.state.sample}
                    />
                }

                <Selector
                    mouseMode={this.state.mouseMode}
                    onPointHover={this.onPointHover}
                    onBoxSelect={this.onBoxSelect}
                    onPan={this.onPan}
                    onZoomChange={this.onZoomChange}
                    onZoomComplete={this.onZoomComplete}
                />

                <Navbar
                    onReset={() => this.setState({ ...App.defaultViewState, infoModalVisible: false })}
                    mouseMode={this.state.mouseMode}
                    onSelectBox={() => this.setState((state) => ({ mouseMode: state.mouseMode == 'pan' ? 'box-select' : 'pan' }))}
                    sampleVisible={this.state.sampleVisible}
                    onSampleToggle={() => this.setState((state) => ({ sampleVisible: !state.sampleVisible }))}
                    onInfoToggle={() => this.setState((state) => ({ infoModalVisible: !state.infoModalVisible }))}
                />

                <InfoModal
                    visible={this.state.infoModalVisible}
                    onCloseClick={() => this.setState({ infoModalVisible: false })}
                />
            </div>
        );
    }

    componentDidMount() {
        this.resizeObserver.observe(this.container.current);

        // get dimensions for the drawing canvas
        this.pullContainerDimensions();

        // monitor URL for changes to feed into state
        window.addEventListener('popstate', this.pushStateToURL);
    }

    componentWillUnmount() {
        this.resizeObserver.disconnect();
        window.removeEventListener('popstate', this.pushStateToURL);
    }

    componentDidUpdate(prevProps, prevState) {
        const viewChanged = prevState.x != this.state.x
            || prevState.y != this.state.y
            || prevState.zoom != this.state.zoom
            || prevState.precision != this.state.precision;

        if (viewChanged) this.pushStateToURLDebounced();
    }

    onPointHover(x, y) {
        if (this.state.sampleVisible) {
            this.setState((state, props) => {
                const { center, zoom, precision, width, height } = state;
                const geo = getModelGeometry(center, zoom, precision);
                const point = geo.rectToImaginary(width, height, x, y);
                return {};
                return { sample: mbSample(point.re, point.im) };
            });
        }
    }

    onPan(dx, dy) {
        this.setState((state, props) => {
            const { center, zoom, precision, width, height } = state;
            const geo = getModelGeometry(center, zoom, precision);

            // new center
            const newCenter = geo.rectToImaginary(
                width,
                height,
                width / 2 - dx,
                height / 2 - dy
            );

            return { center: newCenter };
        });
    }

    onZoomChange(position, scale) {
        this.setState({ postZoom: scale });
    }

    /* bake postZoom into base zoom */
    onZoomComplete() {
        this.setState((state, props) => {
            const { center, zoom, precision, postZoom } = state;
            const geo = getModelGeometry(center, zoom, precision);
            return { zoom: geo.magnify(postZoom), postZoom: 1 };
        });
    }

    onBoxSelect(box) {
        this.setState((state, props) => {
            const { center, zoom, precision, width, height } = state;
            const geo = getModelGeometry(center, zoom, precision);

            const newCenter = geo.rectToImaginary(
                width,
                height,
                box.left + box.width / 2,
                box.top + box.height / 2
            );

            // zoom so the box is fully shown as big as possible
            const fitWidth = box.width / width > box.height / height;
            const factor = fitWidth ? width / box.width : state.height / box.height;
            const newZoom = geo.magnify(factor);

            console.debug("sub box selected with center", newCenter, "magnifying x", factor, 'to zoom level', newZoom);
            return {
                center: newCenter,
                zoom: newZoom,
                postZoom: 1,
                mouseMode: 'pan',
            }
        });
    }
}

class MandelbrotSet extends React.Component {
    static framePeriod = 100; // frame throlling in ms

    static defaultProps = {
        canvasWidth: 400,
        canvasHeight: 400,
    }

    constructor(props) {
        super(props);
        this.model = new ModelClient();

        // drawing canvas and loop
        this.canvas = React.createRef();
        this.running = false;
        this.clear = false; // flag to clear canvas before next update
        this.animationFrame = this.animationFrame.bind(this);
        this.lastFrameTime = null;
    }

    render() {
        return (
            <canvas
                ref={this.canvas}
                width={this.props.canvasWidth}
                height={this.props.canvasHeight}
                className="mandelbrotset">
            </canvas>
        );
    }

    drawSnaps(snaps, update) {
        const { center, zoom, precision, canvasWidth, canvasHeight, postZoom } = this.props;
        const geo = getModelGeometry(center, zoom, precision);

        // main drawing context
        const context = this.canvas.current.getContext('2d', { alpha: false });

        // clear canvas if it's not an update
        if (!update) {
            context.fillStyle = "black";
            context.fillRect(0, 0, canvasWidth, canvasHeight);
        }

        // check the snap has at least one pixel on canvas and paint
        for (const snap of snaps) {
            const { panelX, panelY, length, bitmap } = snap;
            const { top, left } = geo.getPixelCoordinates(panelX, panelY, length, canvasWidth, canvasHeight, postZoom);
            const lengthWithPostZoom = length * postZoom;

            const visible = (left + lengthWithPostZoom >= 0)
                && (left < canvasWidth)
                && (top + lengthWithPostZoom >= 0)
                && (top < canvasHeight);

                /*
                console.log('snap', snap);
                console.log('top', top);
                console.log('left', left);
                console.log('lengthWithPostZoom', lengthWithPostZoom);
                console.log('visible', visible);
                */

                if (visible) context.drawImage(bitmap, left, top, lengthWithPostZoom, lengthWithPostZoom);
        }
    }

    animationFrame(timestamp) {
        const throttlePassed = !this.lastFrameTime || (this.lastFrameTime + MandelbrotSet.framePeriod < timestamp);

        if (this.running && throttlePassed && this.canvas.current && this.model) {
            const { snaps, update } = this.model.flush();
            this.drawSnaps(snaps, update);
            this.lastFrameTime = timestamp;
        }

        // animation loop
        if (this.running) window.requestAnimationFrame(this.animationFrame);
    }

    componentDidMount() {
        this.model.initiate();
        this.running = true;
        window.requestAnimationFrame(this.animationFrame);

        // start model
        const { zoom, precision, center, canvasWidth, canvasHeight } = this.props;
        this.model.setup(zoom, precision);
        this.model.setView(center, canvasWidth, canvasHeight);
    }

    componentDidUpdate(prevProps, prevState) {
        const { zoom, precision, postZoom, center, canvasWidth, canvasHeight } = this.props;

        const setupUpdate = zoom != prevProps.zoom || precision != prevProps.precision;
        if (setupUpdate) {
            console.debug('update to zoom level and/or precision', zoom, precision);
            this.model.setup(zoom, precision);
        }

        const viewUpdate = setupUpdate
            || center.re != prevProps.center.re
            || center.im != prevProps.center.im
            || canvasWidth != prevProps.canvasWidth
            || canvasHeight != prevProps.canvasHeight
            || postZoom != prevProps.postZoom;

        if (viewUpdate) {
            console.debug('update to view', center.re, center.im, canvasWidth, canvasHeight, postZoom);
            this.model.setView(center, canvasWidth, canvasHeight, postZoom);
        }
    }

    componentWillUnmount() {
        this.running = false;
        this.model.terminate();
        this.model = null;
    }
}

class SampleDisplay extends React.Component {
    static floatFormat = new Intl.NumberFormat(
        "us-en",
        {
            signDisplay: 'always',
            minimumFractionDigits: 15,
            maximumFractionDigits: 15
        }).format;

    constructor(props) {
        super(props);
        this.canvas = React.createRef();
    }

    draw() {
        const { center, zoom, width, height, sample } = this.props;
        const canvas = this.canvas.current;

        // no canvas to draw on
        if (!canvas) {
            return;
        }

        // blank slate
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, width, height);

        // check something is specified to draw
        if (!sample) {
            return;
        }

        // convert coordinates to rectangle
        const points = sample.zi.map(z => imaginarytoRect(center, zoom, width, height, complex(z[0], z[1])));

        // draw line between points
        context.beginPath();
        context.strokeStyle = "white";
        context.lineWidth = 2;

        // move to first point
        const point0 = points[0];
        context.moveTo(point0.x, point0.y);

        // line to further points
        for (const point of points) {
            context.lineTo(point.x, point.y);
        }
        context.stroke();

        // circles with point index
        // todo
    }

    render() {
        const { center, zoom, width, height, sample } = this.props;

        // no sample supplied
        if (!sample) {
            return;
        }

        // get initial point in the sample after the origin        
        const [point_re, point_im] = sample.zi[1];
        const point = complex(point_re, point_im);

        // put the tooptip at the initial point
        const pointPosition = imaginarytoRect(center, zoom, width, height, point);
        const escape = Number.isFinite(sample.escapeAge);

        return (
            <div>
                {/* numbered points and joining line */}
                <canvas ref={this.canvas} width={width} height={height}></canvas>

                {/* tooltip */}
                <div className="sample-infobox" style={{ left: pointPosition.x, top: pointPosition.y }}>
                    <p>{SampleDisplay.floatFormat(point.re)}</p>
                    <p>{SampleDisplay.floatFormat(point.im)}i</p>
                    <hr></hr>
                    <p>
                        z<sub>n</sub>
                        <span className={escape ? 'sample-escaped' : 'sample-bounded'}>
                            {escape ? " escapes " : " remains bounded"}
                        </span>
                        {escape ? `at n=${sample.escapeAge}` : ""}
                    </p>
                </div>
            </div>
        );
    }

    componentDidMount() {
        this.draw();
    }

    componentDidUpdate(prevProps, prevState) {
        if (!_.isEqual(this.props, prevProps)) this.draw();
    }
}

/* Component for displaying the current mouse selected zoom box */
class SelectorZoomBox extends React.Component {
    render() {
        const { top, left, width, height } = this.props.rect;
        return <div className="selector-box" style={{ top: top, left: left, width: width, height: height }}></div>
    }
}


/* 
class to handle zooming, selecting, hovering
coordinates here are all in pixels in the div rectangle
*/
class Selector extends React.Component {
    static defaultProps = {
        // mouseMode determines what the mouse does when clicked and draged
        // 'pan' for panning (default for screen, always for mobile)
        // 'box-select' for selecting a rectangle zoom box
        mouseMode: 'pan',
    }

    constructor(props) {
        super(props);

        this.state = {
            startPoint: null,
            currentPoint: null,
        };

        // selection surface - this matches the mandelbrot canvas
        this.div = React.createRef();

        // div that is listening to cursor events and event handlers
        // will be updated to match div on changes to div
        this.divListening = null;

        // touch events listening via Hammer.js
        this.hammer = null; // https://hammerjs.github.io/api/

        // input events handlers
        this.handleHover = this.handleHover.bind(this);
        this.handlePan = this.handlePan.bind(this);
        this.handlePinch = this.handlePinch.bind(this);
        this.handlePress = this.handlePress.bind(this);
    }

    getCursorClass() {
        if (this.props.mouseMode == "box-select") {
            return "boxselecting";
        } else if (this.props.mouseMode == "pan") {
            return this.state.startPoint ? "grabbing" : "grabbable";
        } else {
            console.error("unknown state selecting cursor");
            return "";
        }
    }

    render() {
        const { startPoint, currentPoint } = this.state;

        // zoom box
        let box;
        if (this.props.mouseMode == "box-select" && startPoint && currentPoint) {
            const rect = this.boxGeometry(startPoint.x, startPoint.y, currentPoint.x, currentPoint.y);
            if (rect.width || rect.height) box = <SelectorZoomBox rect={rect} />;
        }

        // full thing
        return (
            <div ref={this.div} className={"selector " + this.getCursorClass()}>
                {box}
            </div>
        );
    }

    setListeners() {
        const div = this.div.current;

        if (div) {
            this.divListening = div;

            const hammer = this.hammer = new Hammer(this.divListening);
            hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL });
            hammer.get('pinch').set({ enable: true });
            hammer.on('panstart panend panmove pancancel', this.handlePan);
            hammer.on('pinchstart pinchmove pinchend pinchcancel', this.handlePinch);
            hammer.on('press', this.handlePress);

            // standard listener for hovering event
            this.divListening.addEventListener('mousemove', this.handleHover);
        }
    }

    removeListeners() {
        this.hammer && this.hammer.destroy();
        this.hammer = null;

        if (this.divListening) {
            this.divListening.removeEventListener('mousemove', this.handleHover);
            this.divListening = null;
        }
    }

    componentDidMount() {
        this.setListeners();
    }

    componentDidUpdate(prevProps, prevState) {
        if (this.divListening != this.div.current) {
            this.removeListeners();
            this.setListeners();
        }
    }

    componentWillUnmount() {
        this.removeListeners();
    }

    // get box geometry with corners specified
    boxGeometry(initialX, initialY, currentX, currentY) {
        const rect = {
            left: initialX,
            top: initialY,
            width: currentX - initialX,
            height: currentY - initialY,
        };

        // correct inside out rectangle
        if (rect.width < 0) {
            rect.left = rect.left + rect.width;
            rect.width *= -1;
        }

        if (rect.height < 0) {
            rect.top = rect.top + rect.height;
            rect.height *= -1;
        }

        return rect;
    }

    // convert client coordinates to local div coordinates
    getLocalCoordinates(clientX, clientY, clip = true) {
        const rect = this.div.current.getBoundingClientRect();
        let x = clientX - rect.left;
        let y = clientY - rect.top;

        // clip cursor position to the app frame
        if (clip) {
            x = Math.min(Math.max(0, x), rect.width);
            y = Math.min(Math.max(0, y), rect.height);
        }

        return { x: x, y: y };
    }

    handleHover(e) {
        const position = this.getLocalCoordinates(e.clientX, e.clientY);
        const { startPoint, currentPoint } = this.state;

        if (!startPoint && !currentPoint) {
            this.props.onPointHover && this.props.onPointHover(position.x, position.y);
        }
    }

    handlePan(e) {
        const position = this.getLocalCoordinates(e.center.x, e.center.y);

        switch (e.type) {
            case 'panstart': {
                this.setState({ startPoint: position });
                break;
            }

            case 'panmove': {
                const { startPoint, currentPoint } = this.state;

                if (this.props.mouseMode == "pan" && currentPoint) {
                    const dx = position.x - currentPoint.x;
                    const dy = position.y - currentPoint.y;
                    this.props.onPan && this.props.onPan(dx, dy);
                }

                // update state for box selection render
                this.setState({ currentPoint: position });
                break;
            }

            case 'panend': {
                const { startPoint } = this.state;

                if (this.props.mouseMode == "box-select" && startPoint) {
                    const box = this.boxGeometry(startPoint.x, startPoint.y, position.x, position.y);
                    box.width && box.height && this.props.onBoxSelect && this.props.onBoxSelect(box);
                }

                // fall through to pancancel
            }

            case 'pancancel': {
                this.setState({ startPoint: null, currentPoint: null });
                break;
            }
        }
    }

    handlePinch(e) {
        const position = this.getLocalCoordinates(e.center.x, e.center.y);
        const scale = e.scale;

        switch (e.type) {
            case 'pinchstart': {
                break;
            }

            case 'pinchmove': {
                this.props.onZoomChange && this.props.onZoomChange(position, scale);
                break;
            }

            case 'pinchend': {
                this.props.onZoomComplete && this.props.onZoomComplete(position, scale);
            }

            case 'pinchcancel': {
                break;
            }
        }
    }

    handlePress(e) {
        console.log('press', e);
    }
}

class Navbar extends React.Component {
    static defaultProps = {
        mouseMode: 'pan', // 'pan' and 'box-select' mouse mode
        sampleVisible: false,

        onReset: null,
        onSelectBox: null,
        onSampleToggle: null,
        onInfoToggle: null,
    }

    constructor(props) {
        super(props);
    }

    render() {
        const navItemClass = 'navbar-item';
        const navItemActiveClass = 'navbar-item navbar-item-active';

        return (
            <div className="navbar">
                <div className={navItemClass} onClick={this.props.onReset}>
                    {/* house icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
                        <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
                    </svg>
                </div>

                <div className={this.props.mouseMode == 'box-select' ? navItemActiveClass : navItemClass} onClick={this.props.onSelectBox} >
                    {/* selection square icon to activate box selection */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M2 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM0 2a2 2 0 0 1 3.937-.5h8.126A2 2 0 1 1 14.5 3.937v8.126a2 2 0 1 1-2.437 2.437H3.937A2 2 0 1 1 1.5 12.063V3.937A2 2 0 0 1 0 2zm2.5 1.937v8.126c.703.18 1.256.734 1.437 1.437h8.126a2.004 2.004 0 0 1 1.437-1.437V3.937A2.004 2.004 0 0 1 12.063 2.5H3.937A2.004 2.004 0 0 1 2.5 3.937zM14 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM2 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm12 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
                    </svg>
                </div>

                <div className={this.props.sampleVisible ? navItemActiveClass : navItemClass} onClick={this.props.onSampleToggle}>
                    {/* cursor icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z" />
                    </svg>
                </div>

                <div className={navItemClass} onClick={this.props.onInfoToggle}>
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
