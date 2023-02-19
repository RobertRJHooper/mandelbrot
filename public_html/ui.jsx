"use strict";

/** React class that handles displaying the mandelbrot set and an user interface for exploring it */
class App extends React.Component {

    /**
     * Fully zoomed out view of mandelbrot set
     */
    static homeView = {
        viewRe: "0",
        viewIm: "0",
        zoom: "220",
    };

    /**
     * Time delay to show user interface before auto-hiding
     */
    static userInterfaceHideDelay = 3000;

    constructor(props) {
        super(props);

        this.state = {

            // complex coordinates of the center of the view
            // The initial value is a beautiful point. These are overwritten if
            // values are specified in the URL parameters
            viewRe: "-1.3734347650208165",
            viewIm: "+0.0847181657743398",

            // zoom is the number of pixels per unit in the imaginary plane
            zoom: "75000",

            // number of significant figures that high precision number have
            // for low values / not specified: regular Javascript numbers are used
            // for high values: custom (slow) Decimal.js objects are used with rounding
            // to 'precision' decimal places
            precision: 0,

            // get any parameters from URL
            ...this.getURLParams() || {},

            // pixel dimensions of the display element
            width: 0,
            height: 0,

            // What does panning with the mouse or touch pad do
            // 'pan'        - move the center point around 
            // 'box-select' - draw a box and zoom into that box on release
            mouseMode: 'pan',

            // zoom modifier so the image scales with a pinch operation
            // This is reset and baked into center at the end of a pinch
            postZoom: 1,

            // statistics from main calculation workers
            statistics: null,

            // (complex) point to display runout sample
            sampleVisible: false,
            sample: null,

            // flag that shows the statistics and navbar
            // when set to false the stats and navbar will fade after
            // a few seconds via style sheet mechanism
            userInterfaceVisible: false,
        }

        // keep track of container dimensions
        this.container = React.createRef();

        // external state observation to monitor the display container pixel dimensions
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target == this.container.current)
                    this.pullContainerDimensions();
            }
        });

        // callbacks for child elements
        this.onBoxSelect = this.onBoxSelect.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
        this.onPan = this.onPan.bind(this);
        this.onZoomChange = this.onZoomChange.bind(this);
        this.onZoomComplete = this.onZoomComplete.bind(this);
        this.onStatisticsAvailable = this.onStatisticsAvailable.bind(this);

        // bind functions that can be passed as callbacks
        this.pullStateFromURL = this.pullStateFromURL.bind(this);
        this.pushStateToURLDebounced = _.debounce(this.pushStateToURL.bind(this), 1000);

        // client for getting single point samples
        this.sampler = new SampleClient(this.onSampleAvailable.bind(this));

        // auto hide userinterface when nothing happens
        this.hideUserInterface = _.debounce(
            () => this.setState({ userInterfaceVisible: false }),
            App.userInterfaceHideDelay
        );

        this.showUserInterface = () => {
            if (!this.state.userInterfaceVisible) {
                this.setState({ userInterfaceVisible: true });
                this.hideUserInterface();
            }
        };
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
        const {
            viewRe,
            viewIm,
            zoom,
            precision,
            postZoom,
            width,
            height,
            statistics,
            sample,
            sampleVisible,
            userInterfaceVisible,
        } = this.state;

        return (
            <div>
                <MandelbrotSet
                    viewRe={viewRe} viewIm={viewIm} zoom={zoom} precision={precision}
                    width={width}
                    height={height}
                    postZoom={postZoom}
                    onStatisticsAvailable={this.onStatisticsAvailable}
                />

                {sampleVisible && (postZoom == 1) &&
                    <SampleDisplay
                        viewRe={viewRe} viewIm={viewIm} zoom={zoom} precision={precision}
                        width={width}
                        height={height}
                        sample={sample}
                    />
                }

                <StatisticsDisplay
                    viewRe={viewRe} viewIm={viewIm} zoom={zoom} precision={precision}
                    statistics={statistics}
                    sample={sample}
                    visible={userInterfaceVisible}
                />

                <Selector
                    mouseMode={this.state.mouseMode}
                    onPointHover={this.onPointHover}
                    onBoxSelect={this.onBoxSelect}
                    onPan={this.onPan}
                    onZoomChange={this.onZoomChange}
                    onZoomComplete={this.onZoomComplete}
                />

                <Navbar
                    onReset={() => this.setState(App.homeView)}
                    mouseMode={this.state.mouseMode}
                    onSelectBox={() => this.setState(state => ({ mouseMode: state.mouseMode == 'pan' ? 'box-select' : 'pan' })) }
                    sampleVisible={sampleVisible}
                    onSampleToggle={() => this.setState(state => ({ sampleVisible: !state.sampleVisible })) }
                    visible={userInterfaceVisible}
                />
            </div>
        );
    }

    componentDidMount() {
        this.resizeObserver.observe(this.container.current);

        // get dimensions for the drawing canvas
        this.pullContainerDimensions();

        // monitor URL for changes to feed into state
        window.addEventListener('popstate', this.pullStateFromURL);

        // initiate sampler system
        this.sampler.initiate();

        // show interface initially
        this.showUserInterface();
    }

    componentWillUnmount() {
        this.resizeObserver.disconnect();
        window.removeEventListener('popstate', this.pullStateFromURL);
        this.sampler.terminate();
    }

    componentDidUpdate(prevProps, prevState) {
        const { viewRe, viewIm, zoom, precision, showUserInterface } = this.state;

        // update the URL
        const viewChanged = 0
            || prevState.viewRe != viewRe
            || prevState.viewIm != viewIm
            || prevState.zoom != zoom
            || prevState.precision != precision;
        if (viewChanged) this.pushStateToURLDebounced();
    }

    /* get viewbox as specified in the URL */
    getURLParams() {
        const url = new URL(window.location);
        const searchParams = url.searchParams;

        // validator of decimal numbers in string format
        // this just checks they are valid numbers but doesn't parse from string
        // because they may truncate the precision to check
        function isDefined(x) { return typeof (x) != 'undefined' && x != null; }
        function isValidNumber(x) { return Number.isFinite(Number(x)); }

        // names of parameters and corresponding state variable name
        const names = {
            re: 'viewRe',
            im: 'viewIm',
            zoom: 'zoom',
            precision: 'precision'
        }

        // retreive and validate parameters that are specified
        const out = {};

        for (const name in names) {
            const value = searchParams.get(name);

            if (!isDefined(value))
                continue;

            if (!isValidNumber(value)) {
                console.error('bad parameter', name, value);
                return;
            }

            out[names[name]] = value;
        }

        // check zoom is positive
        if (isDefined(out.zoom) && out.zoom.startsWith('-')) {
            console.error('zoom must be positive');
            return;
        }

        // check precision is positive
        if (isDefined(out.precision) && out.precision.startsWith('-')) {
            console.error('precision must be positive');
            return;
        }

        // parse precision to a number
        if (isDefined(out.precision))
            out.precision = Number(out.precision);

        return out;
    }

    /* Pull the view from the URL to the state */
    pullStateFromURL() {
        const current = this.getURLParams();
        current && this.setState(current);
    }

    /* push the view from the state to the URL */
    pushStateToURL() {
        const { viewRe, viewIm, zoom, precision } = this.state;
        const current = this.getURLParams();

        // check to see if the URL needs updating
        const changed = !current
            || current.viewRe != viewRe
            || current.viewIm != viewIm
            || current.zoom != zoom
            || current.precision != precision;

        // update URL on change
        if (changed) {
            const url = new URL(window.location);
            const searchParams = url.searchParams;
            searchParams.set('re', viewRe);
            searchParams.set('im', viewIm);
            searchParams.set('zoom', zoom);
            precision && searchParams.set('precision', precision);
            window.history.pushState({}, '', url);
        }
    }

    /* pull the container dimensions into the state */
    pullContainerDimensions() {
        const container = this.container.current;

        this.setState({
            width: container.offsetWidth,
            height: container.offsetHeight,
        });
    }

    /* callback to receive statistics from calculation workers */
    onStatisticsAvailable(statistics) {
        this.setState(state => state.statistics != statistics ? { statistics: statistics } : {});
    }

    onPointHover(x, y) {
        const { viewRe, viewIm, zoom, precision, width, height, sampleVisible } = this.state;

        if (sampleVisible) {
            const geo = getModelGeometry(viewRe, viewIm, zoom, precision);
            const samplePoint = geo.rectToImaginary(width, height, x, y);
            this.sampler.submit(samplePoint.re, samplePoint.im, precision);
        }

        // show user interface for a while
        this.showUserInterface();
    }

    onSampleAvailable(sample) {
        this.setState({ sample: sample });
    }

    onPan(dx, dy) {
        this.setState((state, props) => {
            const { viewRe, viewIm, zoom, precision, width, height } = state;
            const geo = getModelGeometry(viewRe, viewIm, zoom, precision);

            // new center
            const center = geo.rectToImaginary(
                width,
                height,
                width / 2 - dx,
                height / 2 - dy
            );

            return { viewRe: center.re, viewIm: center.im };
        });

        // show user interface for a while
        this.showUserInterface();
    }

    onZoomChange(scale) {
        this.setState({ postZoom: scale });
    }

    /* callback that bakes postZoom into base zoom */
    onZoomComplete() {
        this.setState((state, props) => {
            const { viewRe, viewIm, zoom, precision, postZoom } = state;
            const geo = getModelGeometry(viewRe, viewIm, zoom, precision);
            return { zoom: geo.magnify(postZoom), postZoom: 1 };
        });

        // show user interface for a while
        this.showUserInterface();
    }

    /* callback when a zoom box is selected by the selector */
    onBoxSelect(box) {
        this.setState(state => {
            const { viewRe, viewIm, zoom, precision, width, height } = state;
            const geo = getModelGeometry(viewRe, viewIm, zoom, precision);

            const center = geo.rectToImaginary(
                width,
                height,
                box.left + box.width / 2,
                box.top + box.height / 2
            );

            // zoom so the box is fully shown as big as possible
            const fitWidth = box.width / width > box.height / height;
            const factor = fitWidth ? width / box.width : height / box.height;
            const newZoom = geo.magnify(factor);

            console.debug("sub box selected with center", center.re, center.im);
            console.debug("magnifying x", factor);
            console.debug("zoom level", newZoom);

            return {
                viewRe: center.re,
                viewIm: center.im,
                zoom: newZoom,
                postZoom: 1,
                mouseMode: 'pan',
            }
        });

        // show user interface for a while
        this.showUserInterface();
    }
}

/* class to calculate and display a portion of mandelbrot set */
class MandelbrotSet extends React.Component {
    static framePeriod = 200; // frame throlling in ms

    static defaultProps = {
        width: 400,
        height: 400,
    }

    constructor(props) {
        super(props);
        this.model = new PanelsClient();

        // drawing canvas and loop
        this.canvas = React.createRef();
        this.running = false;
        this.animationFrame = this.animationFrame.bind(this);
        this.lastFrameTime = null;
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

    drawSnaps(snaps, update) {
        const { viewRe, viewIm, zoom, precision, width, height, postZoom } = this.props;
        const geo = getModelGeometry(viewRe, viewIm, zoom, precision);

        // main drawing context
        const context = this.canvas.current.getContext('2d', { alpha: false });

        // clear canvas if it's not an update
        if (!update) {
            context.fillStyle = "black";
            context.fillRect(0, 0, width, height);
        }

        // check the snap has at least one pixel on canvas and paint
        for (const snap of snaps) {
            const { panelX, panelY, length, bitmap } = snap;
            const { top, left } = geo.getPixelCoordinates(panelX, panelY, length, width, height, postZoom);
            const lengthWithPostZoom = length * postZoom;

            const visible = (left + lengthWithPostZoom >= 0)
                && (left < width)
                && (top + lengthWithPostZoom >= 0)
                && (top < height);

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

        // get latest info from workers
        if (this.running && throttlePassed && this.canvas.current && this.model) {
            const { snapshots, update } = this.model.flush();
            this.drawSnaps(snapshots, update);
            this.lastFrameTime = timestamp;

            // pass statistics back to parent
            const { onStatisticsAvailable } = this.props;
            onStatisticsAvailable && onStatisticsAvailable(this.model.statistics);
        }

        // animation loop
        if (this.running) window.requestAnimationFrame(this.animationFrame);
    }

    componentDidMount() {
        const { zoom, precision, viewRe, viewIm, width, height } = this.props;

        // start model
        this.model.initiate();
        this.model.setup(zoom, precision);
        this.model.setView(viewRe, viewIm, width, height);

        // start render loop
        this.running = true;
        window.requestAnimationFrame(this.animationFrame);
    }

    componentDidUpdate(prevProps, prevState) {
        const { viewRe, viewIm, zoom, precision, postZoom, width, height } = this.props;

        const setupUpdate = zoom != prevProps.zoom || precision != prevProps.precision;

        if (setupUpdate) {
            // console.debug('update to zoom level and/or precision', zoom, precision);
            this.model.setup(zoom, precision);
        }

        const viewUpdate = setupUpdate
            || viewRe != prevProps.viewRe
            || viewIm != prevProps.viewIm
            || width != prevProps.width
            || height != prevProps.height
            || postZoom != prevProps.postZoom;

        if (viewUpdate) {
            // console.debug('update to view', viewRe, viewIm, width, height, postZoom);
            this.model.setView(viewRe, viewIm, width, height, postZoom);
        }
    }

    componentWillUnmount() {
        this.running = false;
        this.model.terminate();
        this.model = null;
    }
}

/* class to display the runout of a single point under the mandelbrot iteration */
class SampleDisplay extends React.Component {
    constructor(props) {
        super(props);
        this.canvas = React.createRef();
    }

    draw() {
        const { viewRe, viewIm, zoom, precision, width, height, sample } = this.props;
        const geo = getModelGeometry(viewRe, viewIm, zoom, precision);
        const canvas = this.canvas.current;

        // no canvas to draw on
        if (!canvas) return;

        // blank slate
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, width, height);

        // check something is specified to draw
        if (!sample) return;

        // convert complex coordinates to canvas coordinates
        const points = sample.runout.map(z => geo.imaginaryToRect(width, height, z[0], z[1]));

        // draw line between points
        context.strokeStyle = "white";
        context.lineWidth = 2;

        for (let i = 1; i < points.length; i++) {
            const point0 = points[i - 1];
            const point1 = points[i];
            context.beginPath();
            context.moveTo(point0.x, point0.y);
            context.lineTo(point1.x, point1.y);
            context.stroke();
        }

        // draw circles at each point
        const radius = 5;
        context.fillStyle = sample.escapeAge !== null ? "red" : "green";
        context.strokeStyle = "black";
        context.lineWidth = 1;

        for (let i = points.length - 1; i; i--) {
            const point = points[i];
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, 2 * Math.PI);
            context.fill();
            context.stroke();
        }
    }

    render() {
        const { width, height, sample } = this.props;
        if (!sample) return;
        return <canvas ref={this.canvas} width={width} height={height}></canvas>;
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

            // standard listener for hovering event and stroll wheel
            this.divListening.addEventListener('mousemove', this.handleHover);
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
        const scale = e.scale;

        // at the moment all zooming is from center point
        // const position = this.getLocalCoordinates(e.center.x, e.center.y);

        switch (e.type) {
            case 'pinchstart': {
                break;
            }

            case 'pinchmove': {
                this.props.onZoomChange && this.props.onZoomChange(scale);
                break;
            }

            case 'pinchend': {
                this.props.onZoomComplete && this.props.onZoomComplete();
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

/* Class used to display the navigation buttons and report back, using callback functions, when the user makes input */
class Navbar extends React.Component {
    static defaultProps = {
        visible: false,

        mouseMode: 'pan', // 'pan' and 'box-select' mouse mode
        sampleVisible: false,

        // callback functions
        onReset: null,
        onSelectBox: null,
        onSampleToggle: null,
    }

    constructor(props) {
        super(props);
    }

    render() {
        const {
            visible,
            sampleVisible,
            mouseMode,

            // callbacks
            onReset,
            onSelectBox,
            onSampleToggle,
        } = this.props;

        return (
            <div className={visible ? "navbar visible" : "navbar"}>
                <div className={mouseMode == 'box-select' ? "navbar-item navbar-item-active" : "navbar-item"} onClick={onSelectBox} >
                    {/* selection square icon to activate box selection */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M2 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM0 2a2 2 0 0 1 3.937-.5h8.126A2 2 0 1 1 14.5 3.937v8.126a2 2 0 1 1-2.437 2.437H3.937A2 2 0 1 1 1.5 12.063V3.937A2 2 0 0 1 0 2zm2.5 1.937v8.126c.703.18 1.256.734 1.437 1.437h8.126a2.004 2.004 0 0 1 1.437-1.437V3.937A2.004 2.004 0 0 1 12.063 2.5H3.937A2.004 2.004 0 0 1 2.5 3.937zM14 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM2 13a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm12 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" />
                    </svg>
                </div>

                <div className="navbar-item" onClick={onReset}>
                    {/* house icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
                        <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
                    </svg>
                </div>

                <div className={sampleVisible ? "navbar-item navbar-item-active" : "navbar-item"} onClick={onSampleToggle}>
                    {/* cursor icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z" />
                    </svg>
                </div>

            </div>

        );
    }
}

/* Class used to display dynamic information */
class StatisticsDisplay extends React.Component {
    static floatFormat = new Intl.NumberFormat(
        "us-en",
        {
            signDisplay: 'always',
            minimumFractionDigits: 15,
            maximumFractionDigits: 15
        }).format;

    static defaultProps = {
        visible: false,
        viewRe: "0",
        viewIm: "0",
        zoom: "100",
        iteration: 0,

        // sample as retuned from SampleClient callback
        sample: null,
    }

    render() {
        const { visible, viewRe, viewIm, zoom, statistics, sample } = this.props;
        const escape = sample && sample.determined && (sample.escapeAge !== null);

        return (
            <div className={visible ? "statistics visible" : "statistics"}>
                <p>
                    z<sub>n+1</sub> = (z<sub>n</sub>)<sup>2</sup> + c
                </p>
                <p>
                    <b>View center (c)</b><br />
                    {StatisticsDisplay.floatFormat(viewRe)}<br />
                    {StatisticsDisplay.floatFormat(viewIm)}i<br />
                </p>

                <p>
                    <b>Zoom (pixels/unit)</b><br />
                    {Math.round(zoom.toString())}<br />
                </p>

                <p>
                    <b>Iteration (n)</b><br />
                    {statistics && statistics.iteration || 0}<br />
                </p>

                <p>
                    <b>Sample point (c)</b><br />
                    {StatisticsDisplay.floatFormat(sample && sample.re || 0)}<br />
                    {StatisticsDisplay.floatFormat(sample && sample.im || 0)}i<br />

                    z<sub>n</sub> {escape ?
                        <span>escapes at n={sample && sample.escapeAge || 0}</span>
                        :
                        <span>remains bounded</span>
                    }
                </p>
            </div>
        );
    }
}


