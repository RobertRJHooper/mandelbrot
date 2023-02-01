"use strict";

var isNum = Number.isFinite

class App extends React.Component {
    static defaultViewState = {
        center_re: 0,
        center_im: 0,
        zoom: 200,
        postZoom: 1,
    };

    constructor(props) {
        super(props);

        this.state = {
            ...App.defaultViewState,
            ...this.pullURL(),
            width: 0,
            height: 0,

            // 'pan' or 'box-select'
            mouseMode: 'pan',

            // single (complex) point runout sample display
            sample: null,
            sampleVisible: false,
            infoModalVisible: false,
        }

        // keep track of container dimensions
        this.container = React.createRef();
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.target == this.container.current) {
                    this.pullContainerDimensions();
                }
            }
        });

        this.onBoxSelect = this.onBoxSelect.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
        this.onPanAndZoom = this.onPanAndZoom.bind(this);
        this.onZoomComplete = this.onZoomComplete.bind(this);

        // pushing zoom back to URL on updates with debounce throttling
        this.pushURLDebounced = _.debounce(
            () => this.pushURL(this.state.center_re, this.state.center_im, this.state.zoom * this.state.postZoom),
            1000
        );
    }

    /* get viewbox as specified in the URL, or return null */
    pullURL() {
        const url = new URL(window.location);
        const searchParams = url.searchParams;

        const x = Number(searchParams.get('x'));
        const y = Number(searchParams.get('y'));
        const zoom = Number(searchParams.get('zoom'));
        const valid = isNum(x) && isNum(y) && isNum(zoom) && (zoom > 0);

        // bad or missing numbers
        if (!valid) return {};

        return {
            center_re: x,
            center_im: y,
            zoom: zoom,
            postZoom: 1,
        };
    }

    /* push view to the URL if it's not already there */
    pushURL(center_re, center_im, zoom) {
        const current = this.pullURL();
        const changed = current.center_re != center_re || current.center_im != center_im || current.zoom != zoom;

        if (changed) {
            const url = new URL(window.location);
            const searchParams = url.searchParams;
            searchParams.set('x', center_re);
            searchParams.set('y', center_im);
            searchParams.set('zoom', zoom);
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
        return (
            <div>
                <MandelbrotSet
                    center_re={this.state.center_re}
                    center_im={this.state.center_im}
                    zoom={this.state.zoom}
                    postZoom={this.state.postZoom}
                    width={this.state.width}
                    height={this.state.height}
                />

                {this.state.sampleVisible &&
                    <SampleDisplay
                        center_re={this.state.center_re}
                        center_im={this.state.center_im}
                        zoom={this.state.zoom * this.state.postZoom}
                        width={this.state.width}
                        height={this.state.height}
                        sample={this.state.sample}
                    />
                }

                <Selector
                    mouseMode={this.state.mouseMode}
                    onPointHover={this.onPointHover}
                    onBoxSelect={this.onBoxSelect}
                    onPanAndZoom={this.onPanAndZoom}
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
        this.pullContainerDimensions();
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevState.center != this.state.center || prevState.zoom != this.state.zoom) {
            this.pushURLDebounced();
        }
    }

    componentWillUnmount() {
        this.resizeObserver.disconnect();
    }

    onPointHover(x, y) {
        this.setState((state, props) => {
            const { center_re, center_im, zoom, postZoom, width, height } = state;
            const [re, im] = rectToImaginary(center_re, center_im, zoom * postZoom, width, height, x, y);
            return { sample: mbSample(re, im) };
        });
    }

    onPanAndZoom(dx, dy, dzoom) {
        this.setState((state, props) => {
            const { center_re, center_im, zoom, postZoom, width, height } = state;

            // new center
            const [re, im] = rectToImaginary(
                center_re,
                center_im,
                zoom * postZoom,
                width,
                height,
                width / 2 - dx,
                height / 2 - dy
            );

            return {
                center_re: re,
                center_im: im,
                postZoom: postZoom * (1 + dzoom),
            };
        });
    }

    // "bake" postZoom into the base zoom and recalculate
    onZoomComplete() {
        this.setState((state, props) => ({
            zoom: zoom * postZoom,
            postZoom: 1,
        }));
    }

    onBoxSelect(box) {
        this.setState((state, props) => {
            const { center_re, center_im, zoom, postZoom, width, height } = state;

            // new center
            const [re, im] = rectToImaginary(
                center_re,
                center_im,
                zoom * postZoom,
                width,
                height,
                box.left + box.width / 2,
                box.top + box.height / 2
            );

            // zoom so the box is fully shown as big as possible
            const fitWidth = box.width / width > box.height / height;
            const factor = fitWidth ? width / box.width : state.height / box.height;
            const newZoom = zoom * postZoom * factor;

            console.debug("sub box selected with center", center_re, center_im, "magnifying x", factor, 'to zoom level', newZoom);
            return {
                center_re: re,
                center_im: im,
                zoom: newZoom,
                postZoom: 1,
                mouseMode: 'pan',
            }
        });
    }
}

class MandelbrotSet extends React.Component {
    static framePeriod = 1000 / 10;

    static defaultProps = {
        center_re: 0,
        center_im: 0,

        // pixels per unit length of imaginary plane
        zoom: 100,

        // post calculation magnification
        postZoom: 1,

        // canvas dimensions in pixels
        width: 400,
        height: 400,
    }

    constructor(props) {
        super(props);
        this.model = new ModelClient();

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

    animationFrame(timestamp) {
        const throttlePassed = !this.lastFrameTime || (this.lastFrameTime + MandelbrotSet.framePeriod < timestamp);

        if (throttlePassed) {
            const canvas = this.canvas.current;

            if (canvas) {
                const { width, height, postZoom } = this.props;
                const { canvasOffsetX, canvasOffsetY } = this.model;
                const context = canvas.getContext('2d', { alpha: false });

                // blank bitmap fill
                context.fillStyle = "black";

                // paint each snap
                for (const snap of this.model.flush()) {
                    const { bitmap, canvasX, canvasY, length } = snap;
                    const x = canvasOffsetX + canvasX * postZoom;
                    const y = canvasOffsetY + canvasY * postZoom;
                    const l = length * postZoom;

                    // check the snap is on canvas
                    const visible = (x + l >= 0) && (x < width) && (y + l >= 0) && (y < height);

                    if (visible) {
                        if (bitmap) {
                            context.drawImage(bitmap, x, y, l, l);
                        } else {
                            context.fillRect(x, y, l, l);
                        }
                    }
                }
                this.lastFrameTime = timestamp;
            }
        }

        // loop
        if (this.running) {
            window.requestAnimationFrame(this.animationFrame);
        }
    }

    componentDidMount() {
        this.model.initiate();
        this.running = true;
        window.requestAnimationFrame(this.animationFrame);

        const { zoom, center_re, center_im, width, height, postZoom } = this.props;
        this.model.setZoom(zoom);
        this.model.setCenter(center_re, center_im, width, height, postZoom);
    }

    componentDidUpdate(prevProps, prevState) {
        const { zoom, postZoom, center_re, center_im, width, height } = this.props;

        if (zoom != prevProps.zoom) {
            console.debug('update to zoom level', zoom);
            this.model.setZoom(zoom);
        }

        const update = center_re != prevProps.center_re
            || center_im != prevProps.center_im
            || width != prevProps.width
            || height != prevProps.height;

        if (update) {
            console.debug('update to center, width or height', center_re, center_im, width, height, postZoom);
            this.model.setCenter(center_re, center_im, width, height, postZoom);
        }
    }

    componentWillUnmount() {
        this.running = false;
        this.model.terminate();
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
        const { center_re, center_im, zoom, width, height, sample } = this.props;
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
        const points = sample.zi.map(([z_re, z_im]) =>
            imaginarytoRect(center_re, center_im, zoom, width, height, z_re, z_im)
        );

        // draw line between points
        context.beginPath();

        // move to first point
        const [x0, y0] = points[0];
        context.moveTo(x0, y0);

        // line to further points
        for (const point of points) {
            const [x, y] = point;
            context.lineTo(x, y);
        }
        context.stroke();

        // circles with point index
        // todo
    }

    render() {
        const { center_re, center_im, zoom, width, height, sample } = this.props;

        // no sample supplied
        if (!sample) {
            return;
        }

        const [point_re, point_im] = sample.zi[1];
        const [tooltipLeft, tooltipTop] = imaginarytoRect(center_re, center_im, zoom, width, height, point_re, point_im);
        const escape = Number.isFinite(sample.escapeAge);

        return (
            <div>
                {/* numbered points and joining line */}
                <canvas ref={this.canvas} width={width} height={height}></canvas>

                {/* tooltip */}
                <div className="sample-infobox" style={{ left: tooltipLeft, top: tooltipTop }}>
                    <p>{SampleDisplay.floatFormat(point_re)}</p>
                    <p>{SampleDisplay.floatFormat(point_im)}i</p>
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
        if (!_.isEqual(this.props, prevProps)) {
            this.draw();
        }
    }
}

/* Component for displaying the current mouse selected zoom box */
class SelectorZoomBox extends React.Component {
    static defaultProps = {
        rect: null,
    }

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
            selectedPointX: null,
            selectedPointY: null,
            pointX: null,
            pointY: null,
            pinch: null, // last processed pinch touches
        }

        // selection surface - this matches the mandelbrot canvas
        this.div = React.createRef();

        // div that is listening to cursor events and event handlers
        // will be updated to match div on changes to div
        this.divListening = null;

        // touch events listening via Hammer.js
        this.hammer = null; // https://hammerjs.github.io/api/
        this.handlePan = this.handlePan.bind(this);
        this.handlePinch = this.handlePinch.bind(this);
        this.handlePress = this.handlePress.bind(this);

        // callback after zooming with debounce throttling
        this.zoomCompleteDebounced = _.debounce(
            () => this.props.onZoomComplete && this.props.onZoomComplete(),
            300
        );
    }

    getCursorClass() {
        if (this.props.mouseMode == "box-select") {
            return "boxselecting";
        } else if (this.props.mouseMode == "pan") {
            if (isNum(this.state.selectedPointX) && isNum(this.state.selectedPointY)) {
                return "grabbing";
            } else {
                return "grabbable";
            }
        } else {
            console.error("unknown state selecting cursor");
            return "";
        }
    }

    render() {
        const { selectedPointX, selectedPointY, pointX, pointY } = this.state;

        // zoom box
        const validBox = this.props.mouseMode == "box-select"
            && isNum(selectedPointX)
            && isNum(selectedPointY)
            && isNum(pointX)
            && isNum(pointY);

        let box;

        if (validBox) {
            const rect = this.boxGeometry(selectedPointX, selectedPointY, pointX, pointY);
            if (rect.width || rect.height) box = <SelectorZoomBox rect={rect} />;
        }

        return (
            <div ref={this.div} className={"selector " + this.getCursorClass()}>
                {box}
            </div>
        );
    }

    setListeners() {
        const div = this.div.current;

        if (div) {
            const hammer = this.hammer = new Hammer(this.div.current);
            hammer.get('pinch').set({ enable: true });
            hammer.get('pan').set({ direction: Hammer.DIRECTION_ALL });
            hammer.on('pan', this.handlePan.bind(this));
            hammer.on('pinch', this.handlePinch.bind(this));
            hammer.on('press', this.handlePress.bind(this));
            this.divListening = div;
        }
    }

    removeListeners() {
        this.hammer && this.hammer.destroy();
        this.hammer = null;
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

        return [x, y];
    }

    /* old code

    // a point is selected by primary click down or touch down
    handleSelect(clientX, clientY) {
        const [x, y] = this.getLocalCoordinates(clientX, clientY);
        this.setState({ selectedPointX: x, selectedPointY: y });
    }

    // single touch moving or mouse move after primary click down
    handleMove(clientX, clientY) {
        const [x, y] = this.getLocalCoordinates(clientX, clientY);
        const { pointX, pointY, selectedPointX, selectedPointY } = this.state;
        const current = isNum(pointX) && isNum(pointY);
        const selected = isNum(selectedPointX) && isNum(selectedPointY);

        // callbacks
        if (!selected) {
            this.props.onPointHover && this.props.onPointHover(x, y);
        } else if (this.props.mouseMode == "pan") {
            const dx = x - pointX;
            const dy = y - pointX;
            current && (dx || dy) && this.props.onPanAndZoom && this.props.onPanAndZoom(dx, dy, 0);
        }

        // update state
        this.setState({ pointX: x, pointY: y });
    }

    // single touch released or mouse primary released
    handleRelease(clientX, clientY) {
        const [x, y] = this.getLocalCoordinates(clientX, clientY);
        const { selectedPointX, selectedPointY } = this.state;
        const selected = isNum(selectedPointX) && isNum(selectedPointY);
        const delta = (x != selectedPointX) || (y != selectedPointY);

        // callbacks
        if (!delta) {
            this.props.onPointSelect && this.props.onPointSelect(x, y);
        } else if (this.props.mouseMode == "box-select") {
            if (selected) {
                const box = this.boxGeometry(selectedPointX, selectedPointY, x, y);
                box.width && box.height && this.props.onBoxSelect && this.props.onBoxSelect(box);
            }
        }

        // update state
        this.setState({ selectedPointX: null, selectedPointY: null });
    }

    // handle a zoom of given factor about a point x, y in the view
    handleZoom(x, y, dz) {
        console.debug('zoom event', x, y, dz);
        const rect = this.div.current.getBoundingClientRect();

        // determine a translation so that the zoom point
        // is fixed for the enlargement which happens about the center
        const dx = -1 * (x - rect.width / 2) * dz;
        const dy = -1 * (y - rect.height / 2) * dz;

        // pass to master and schedule the release event
        this.props.onPanAndZoom && this.props.onPanAndZoom(dx, dy, dz);
        this.zoomCompleteDebounced();
    }

    */

    handlePan(e) {
        console.log('pan', e);
    }

    handlePinch(e) {
        console.log('pinch', e);
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
