/**
 * React application for displaying the Mandelbrot set with a user interface that
 * allows panning and zooming.
 */

"use strict";

/** React root class that handles displaying the mandelbrot set and an user interface for exploring it */
class App extends React.Component {

    // Fully zoomed out view of mandelbrot set
    static homeView = {
        // complex coordinates of the center of the view
        // The initial value is a beautiful point. These are overwritten if
        // values are specified in the URL parameters
        viewRe: "-0.6376090432511038",
        viewIm: "0.2690716860879459",

        // zoom is the number of pixels per unit in the imaginary plane
        zoom: "628",
    };

    // Time delay to show user interface before auto-hiding
    static userInterfaceHideDelay = 3000;

    /**
     * @constructor
     */
    constructor(props) {
        super(props);

        this.state = {
            ...App.homeView,

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
        // this.sampler = new SampleClient(this.onSampleAvailable.bind(this));

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

    /**
     * Outer render that provides a container that can be measured.
     * Once the measure is passed to the state then the outer render includes the
     * inner contents render.
     */
    render() {
        const { width, height } = this.state;

        return (
            <div className="app" ref={this.container}>
                {width && height && this.renderContent()}
            </div>
        );
    }

    /**
     * Main react render of the App contents.
     */
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

                <StatisticsDisplay
                    viewRe={viewRe} viewIm={viewIm} zoom={zoom} precision={precision}
                    statistics={statistics}
                    // sample={sample}
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
                    onSelectBox={() => this.setState(state => ({ mouseMode: state.mouseMode == 'pan' ? 'box-select' : 'pan' }))}
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
        // this.sampler.initiate();

        // show interface initially
        this.showUserInterface();
    }

    componentWillUnmount() {
        this.resizeObserver.disconnect();
        window.removeEventListener('popstate', this.pullStateFromURL);
        // this.sampler.terminate();
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

    /**
     * Get the viewbox as specified in the URL
     * @returns state parameters of the view box or null if no valid state is in the URL.
     */
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

    /**
     * Pull the viewbox from the URL and to the state
     */
    pullStateFromURL() {
        const current = this.getURLParams();
        console.debug("pulling state from URL");
        current && this.setState(current);
    }

    /**
     * Push the view from the state to the URL if the URL parameters are out of date.
     */
    pushStateToURL() {
        const { viewRe, viewIm, zoom, precision } = this.state;
        const current = this.getURLParams();

        // check to see if the URL needs updating
        const changed = !current
            || current.viewRe != viewRe
            || current.viewIm != viewIm
            || current.zoom != zoom;

        // update URL on change
        if (changed) {
            console.debug("pushing state to URL");
            const url = new URL(window.location);
            const searchParams = url.searchParams;
            searchParams.set('re', viewRe);
            searchParams.set('im', viewIm);
            searchParams.set('zoom', zoom);
            window.history.pushState({}, '', url);
        }
    }

    /**
     * Pull the container dimensions (width and height) into the state
     */
    pullContainerDimensions() {
        const container = this.container.current;

        this.setState({
            width: container.offsetWidth,
            height: container.offsetHeight,
        });
    }

    /**
     * Callback to receive statistics from calculation workers
     */
    onStatisticsAvailable(statistics) {
        this.setState(state => state.statistics != statistics ? { statistics: statistics } : {});
    }

    /**
     * Notification of mouse hover over the main container.
     */
    onPointHover(x, y) {
        this.showUserInterface();
    }

    /**
     * Notification callback of a panning event. 
     * @param {Integer} dx - Change in horizontal pixels
     * @param {Integer} dy - Change in veritcal pixels
     */
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

    /**
     * Notification callback that the user is performing a zoom operation.
     * The App will take the current image and scale it using this figure until
     * the zoom operation is finished and then a full recalculation will start.
     * @param {Number} scale - The reported scaling factor e.g. 1.5x
     */
    onZoomChange(scale) {
        this.setState({ postZoom: scale });
    }

    /**
     * Notification callback that the user has finished performing the zoom operation.
     * This will then notify workers to recalculate from the new zoom level.
     */
    onZoomComplete() {
        this.setState((state, props) => {
            const { viewRe, viewIm, zoom, precision, postZoom } = state;
            const geo = getModelGeometry(viewRe, viewIm, zoom, precision);
            return { zoom: geo.magnify(postZoom), postZoom: 1 };
        });

        // show user interface for a while
        this.showUserInterface();
    }

    /**
     * Notification callback that the user has selected a zoom box.
     * This function notifies workers to recalculate to the new zoom level
     * @param {Rect} - Box geometery in pixels
     */
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

/* React class to arrange calculation and display the mandelbrot set */
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

    /* react render */
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

    /**
     * Draw panel snapshots to the canvas
     * @param {Array.<Object>} snaphosts - The panel snapshots to paint to the canvas
     * @param {boolean} update - True if the snaphosts are cumulative, false if the snaps start from a blank canvas
     */
    drawSnaps(snaphosts, update) {
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
        for (const snap of snaphosts) {
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

    /**
     * Render starting point. Decide if there is something new to add to the canvas and draw it if yes.
     * @param {Object} timestamp High precision timestamp of the frame 
     */
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

/* Component for displaying the current mouse selected zoom box */
class SelectorZoomBox extends React.Component {
    render() {
        const { top, left, width, height } = this.props.rect;
        return <div className="selector-box" style={{ top: top, left: left, width: width, height: height }}></div>
    }
}


/* React component to handle zooming, selecting, hovering coordinates here are all in pixels in the div rectangle */
class Selector extends React.Component {
    static defaultProps = {
        // mouseMode determines what the mouse does when clicked and draged
        // 'pan' for panning (default for screen, always for mobile)
        // 'box-select' for selecting a rectangle zoom box
        mouseMode: 'pan',
    }

    /* Time between last wheel event and reporting end of zoom */
    static wheelZoomTerminationDelay = 1000;

    /* Maximum zoom factor for one go at wheel and pinch zooming */
    static wheelZoomFactorClamp = 10;

    /* Pacing for wheel zoom (from touchpad) */
    static wheelZoomThrottlePeriod = 200;

    /**
     * @constructor
     */
    constructor(props) {
        super(props);

        this.state = {
            startPoint: null,
            currentPoint: null,

            // current wheel zoom factor
            wheelZoom: 1,
        };

        // selection surface - this matches the mandelbrot canvas
        this.div = React.createRef();

        // div that is listening to cursor events and event handlers
        // will be updated to match div on changes to div
        this.divListening = null;

        // touch events listening via Hammer.js
        this.hammer = null;

        // wheel events via hamster.js
        this.hamster = null;

        // terminate wheel zoom
        this.terminateWheelZoom = _.debounce(() => {
            this.props.onZoomComplete && this.props.onZoomComplete();
            this.setState({ wheelZoom: 1 });
        }, Selector.wheelZoomTerminationDelay);

        // input events handlers
        this.handleHover = this.handleHover.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
        this.handlePan = this.handlePan.bind(this);
        this.handlePinch = this.handlePinch.bind(this);
        this.handlePress = this.handlePress.bind(this);

        // zooming by touchpad and wheel on a mouse are handled by the
        // same event but have very different effects
        // we using debouncing and a step funciton to make the effect similar
        this.handleWheelThrottled = _.throttle(
            this.handleWheel,
            Selector.wheelZoomThrottlePeriod
        );
    }

    /**
     * Get the css class name for the setting the cursor shape
     * @returns {String} CSS classname that will display the cursor currently
     */
    getCursorClass() {
        if (this.props.mouseMode == "box-select")
            return "boxselecting";

        if (this.props.mouseMode == "pan")
            return this.state.startPoint ? "grabbing" : "grabbable";

        console.warn("unknown state selecting cursor");
        return "";
    }

    /* React render method */
    render() {
        const { startPoint, currentPoint } = this.state;
        const displayBox = this.props.mouseMode == "box-select" && startPoint && currentPoint;
        const box = displayBox && this.boxGeometry(startPoint.x, startPoint.y, currentPoint.x, currentPoint.y);

        return (
            <div ref={this.div} className={"selector " + this.getCursorClass()}>
                {displayBox && (box.width || box.height) && <SelectorZoomBox rect={box} />}
            </div>
        );
    }

    /* Setup listeners for user interface events for panning, zooming, hovering, etc. */
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

            const hamster = this.hamster = new Hamster(this.divListening);
            hamster.wheel(this.handleWheelThrottled);

            // standard listener for hovering event and stroll wheel
            this.divListening.addEventListener('mousemove', this.handleHover);
        }
    }

    /* Remove listeners for user interface events for panning, zooming, hovering, etc. */
    removeListeners() {
        if (this.hammer) {
            this.hammer.destroy();
            this.hammer = null;
        }

        if (this.hamster) {
            this.hamster.unwheel();
            this.hamster = null;
        }

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

    /**
     * Get the geometry of a box between two poitns representing opposite corners
     * @param {Integer} x0 - Horizontal coordinate of first corner
     * @param {Integer} y0 - Vertical coordinate of first corner
     * @param {Integer} x1 - Horizontal coordinate of second corner
     * @param {Integer} y1 - Vertical coordinate of second corner
     * @returns {Object} Rectangle definied with top, left, width, height fields
    */
    boxGeometry(x0, y0, x1, y1) {
        const rect = {
            left: x0,
            top: y0,
            width: x1 - x0,
            height: y1 - y0,
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

    /**
     * Helper to get coordinates local to the render canvas origin from client coordinates.
     * @param {Integer} clientX Horizontal coordinate relative to client area of the screen
     * @param {Integer} clientY Vertical coordinate relative to client area of the screen
     * @param {Integer} clip - True if the output should be restricted to the visible canvas
     * @returns {Object} Object with fields x and y with the local coordinates
     */
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
        //console.debug('hover event');

        const position = this.getLocalCoordinates(e.clientX, e.clientY);
        const { startPoint, currentPoint } = this.state;

        if (!startPoint && !currentPoint) {
            this.props.onPointHover && this.props.onPointHover(position.x, position.y);
        }
    }

    handlePan(e) {
        // console.debug('pan event');
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
        // console.debug('pinch event');
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

    /* hand wheel and touchpad double finger zoom gesture that is handled in browsers as wheel */
    handleWheel(event, delta, deltaX, deltaY) {
        //console.debug('wheel event', event);

        this.setState(state => {
            const stepY = Math.sign(deltaY);
            const wheelZoom = state.wheelZoom * Math.pow(1.3, stepY);
            const wheelZoomClamped = Math.min(Math.max(wheelZoom, 1 / Selector.wheelZoomFactorClamp), Selector.wheelZoomFactorClamp);
            const wheelZoomChanged = wheelZoomClamped != state.wheelZoom;

            // nothing to report do?
            if (!wheelZoomChanged) return;

            // something to report
            this.props.onZoomChange(wheelZoomClamped);
            return { wheelZoom: wheelZoomClamped };
        });

        // schedule debounced termination of the zoom process
        this.terminateWheelZoom();
    }

    handlePress(e) {
        // console.debug('press event');
    }
}

/* Class used to display the navigation buttons and report back, using callback functions, when the user makes input */
class Navbar extends React.Component {
    static defaultProps = {
        visible: false,

        // 'pan' and 'box-select' mouse mode
        mouseMode: 'pan',

        // callback functions
        onReset: null,
        onSelectBox: null,
    }

    constructor(props) {
        super(props);
    }

    render() {
        const {
            visible,
            mouseMode,

            // callbacks
            onReset,
            onSelectBox,
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
            </div>
        );
    }
}

/* Class used to display information and dynamic information from workers */
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
    }

    render() {
        const { visible, viewRe, viewIm, zoom, statistics } = this.props;

        return (
            <div className={visible ? "statistics visible" : "statistics"}>
                <p>
                    <b>Generator</b><br />
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
            </div>
        );
    }
}


