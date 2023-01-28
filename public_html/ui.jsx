"use strict";

var isNum = Number.isFinite

class App extends React.Component {
    static defaultView = {
        center: complex(0),
        zoom: 200,
    };

    constructor(props) {
        super(props);

        this.state = {
            ...App.defaultView,
            width: 0,
            height: 0,

            mouseMode: 'pan', // 'pan' or 'box-select'
            panCenter: null,
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
        this.onPan = this.onPan.bind(this);
        this.onPanRelease = this.onPanRelease.bind(this);
        this.pushURLDebounced = _.debounce(() => this.pushURL(this.state.center, this.state.zoom), 1000);
    }

    /* get viewbox as specified in the URL, or return null */
    pullURL() {
        const url = new URL(window.location);
        const searchParams = url.searchParams;

        return {
            center: complex(
                Number(searchParams.get('x')),
                Number(searchParams.get('y'))
            ),
            zoom: Number(searchParams.get('z')),
        }
    }

    /* push view to the URL if it's not already there */
    pushURL(center, zoom) {
        const current = this.pullURL();
        const changed = current.center != center || current.zoom != zoom;

        if (changed) {
            const url = new URL(window.location);
            const searchParams = url.searchParams;
            searchParams.set('x', center.re);
            searchParams.set('y', center.im);
            searchParams.set('z', zoom);
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
                    center={this.state.center}
                    zoom={this.state.zoom}
                    width={this.state.width}
                    height={this.state.height}
                />

                {this.state.sampleVisible &&
                    <SampleDisplay
                        center={this.state.center}
                        zoom={this.state.zoom}
                        width={this.state.width}
                        height={this.state.height}
                        sample={this.state.sample}
                    />
                }

                <Selector
                    mouseMode={this.state.mouseMode}
                    onPointHover={this.onPointHover}
                    onBoxSelect={this.onBoxSelect}
                    onPan={this.onPan}
                    onPanRelease={this.onPanRelease}
                />

                <Navbar
                    onReset={() => this.setState({ ...App.defaultView, infoModalVisible: false })}
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
            const { center, zoom, width, height } = state;
            const p = rectToImaginary(center, zoom, width, height, x, y);
            return { sample: mbSample(p) };
        });
    }

    onPan(dx, dy) {
        this.setState((state, props) => {
            const { center, zoom, width, height, panCenter } = state;

            const p = rectToImaginary(
                panCenter || center,
                zoom,
                width,
                height,
                state.width / 2 - dx,
                state.height / 2 - dy
            );

            return {
                panCenter: panCenter || center,
                center: p,
            };
        });
    }

    onPanRelease() {
        this.setState({ panCenter: null });
    }

    onBoxSelect(box) {
        this.setState((state, props) => {
            const { center, zoom, width, height } = state;

            const newCenter = rectToImaginary(
                center,
                zoom,
                width,
                height,
                box.left + box.width / 2,
                box.top + box.height / 2
            );

            // zoom so the box is fully shown as big as possible
            const fitWidth = box.width / width > box.height / height;
            const factor = fitWidth ? width / box.width : state.height / box.height;
            const newZoom = zoom * factor;

            console.log("sub box selected with center", newCenter, "magnifying x", factor, 'to zoom level', newZoom);

            return {
                center: newCenter,
                zoom: newZoom,
                mouseMode: 'pan',
            }
        });
    }


}

class MandelbrotSet extends React.Component {
    static framePeriod = 1000 / 4;
    static iterationsLimit = 4000;

    static defaultProps = {
        center: complex(0),

        // pixels per unit length of imaginary plane
        zoom: 100,

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

    clearCanvas() {
        const canvas = this.canvas.current;
        const context = canvas.getContext('2d');
        context.beginPath();
        context.fillStyle = "grey";
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    animationFrame(timestamp) {
        if (!this.lastFrameTime || this.lastFrameTime + MandelbrotSet.framePeriod >= timestamp) {
            const { width, height } = this.props;
            const { canvasOffsetX, canvasOffsetY } = this.model;
            const canvas = this.canvas.current;

            if (canvas) {
                const context = canvas.getContext('2d', { alpha: false });

                for (const snap of this.model.flush()) {
                    const { bitmap, canvasX, canvasY } = snap;

                    const x = canvasOffsetX + canvasX;
                    const y = canvasOffsetY + canvasY;

                    // check the snap is on canvas
                    const visible = x + bitmap.width >= 0
                        && x < width
                        && y + bitmap.height >= 0
                        && y < height;

                    if (visible) context.drawImage(bitmap, x, y);
                }
            }
        }

        // loop
        if (this.running) {
            this.lastFrameTime = timestamp;
            window.requestAnimationFrame(this.animationFrame);
        }
    }

    componentDidMount() {
        this.model.initiate();
        this.running = true;
        window.requestAnimationFrame(this.animationFrame);

        const { zoom, center, width, height } = this.props;
        this.clearCanvas();
        this.model.setZoom(zoom);
        this.model.setCenter(center, width, height);
    }

    componentDidUpdate(prevProps, prevState) {
        const { zoom, center, width, height } = this.props;

        if (zoom != prevProps.zoom) {
            console.debug('update to zoom level', zoom);
            this.clearCanvas();
            this.model.setZoom(zoom);
        }

        if (center != prevProps.center || width != prevProps.width || height != prevProps.height) {
            console.debug('update to center, width or height', center, width, height);
            this.clearCanvas();
            this.model.setCenter(center, width, height);
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
        const points = sample.zi.map(z => imaginarytoRect(center, zoom, width, height, z));

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
        const { center, zoom, width, height, sample } = this.props;

        // no sample supplied
        if (!sample) {
            return;
        }

        const point = sample.zi[1];
        const [tooltipLeft, tooltipTop] = imaginarytoRect(center, zoom, width, height, point);
        const escape = Number.isFinite(sample.escapeAge);

        return (
            <div>
                {/* numbered points and joining line */}
                <canvas ref={this.canvas} width={width} height={height}></canvas>

                {/* tooltip */}
                <div className="sample-infobox" style={{ left: tooltipLeft, top: tooltipTop }}>
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


/* class to handle zooming, selecting, hovering */
class Selector extends React.Component {
    static defaultProps = {
        // mouseMode determines what the mouse does 
        // 'pan' for panning
        // 'box-select' for selecting a rectangle zoom box
        mouseMode: 'pan',

        // callbacks
        onPan: null,
        onPanRelease: null,
        onZoomStart: null,
        onZoomUpdate: null,
        onZoomRelease: null,
        onBoxSelect: null,
        onPointSelect: null,
    }

    constructor(props) {
        super(props);

        this.state = {
            selectedPointX: null,
            selectedPointY: null,
            currentPointX: null,
            currentPointY: null,
            pinchStart: null,
            pinchCurrent: null,
        }

        // selection surface reference
        this.div = React.createRef();

        // div that were listening to events on and event handlers
        this.divListening = null;
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.onTouchCancel = this.onTouchCancel.bind(this);
        this.onTouchMove = this.onTouchMove.bind(this);
    }

    getCursorClass() {
        if (false) {
            return "zooming-in";
        } else if (false) {
            return "zooming-out";
        } else if (this.props.mouseMode == "box-select") {
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
        const { selectedPointX, selectedPointY, currentPointX, currentPointY } = this.state;
        const validBox = this.props.mouseMode == "box-select"
            && isNum(selectedPointX)
            && isNum(selectedPointY)
            && isNum(currentPointX)
            && isNum(currentPointY);

        // zoom box
        let box;

        if (validBox) {
            const rect = this.boxGeometry(selectedPointX, selectedPointY, currentPointX, currentPointY);
            if (rect.width || rect.height) box = <SelectorZoomBox rect={rect} />;
        }

        return (
            <div ref={this.div} className={"selector " + this.getCursorClass()}>
                {box}
            </div>
        );
    }

    removeListeners() {
        window.removeEventListener("mouseup", this.onMouseUp);

        // client area listeners
        const div = this.divListening;
        if (div) {
            div.removeEventListener("mousedown", this.onMouseDown);
            div.removeEventListener("mousemove", this.onMouseMove);
            div.removeEventListener("touchstart", this.onTouchStart);
            div.removeEventListener("touchend", this.onTouchEnd);
            div.removeEventListener("touchcancel", this.onTouchCancel);
            div.removeEventListener("touchmove", this.onTouchMove);
            this.divListening = null;
        }
    }

    setListeners() {
        this.removeListeners();

        // global listeners
        window.addEventListener("mouseup", this.onMouseUp);

        // client area listeners
        const div = this.div.current;

        if (div) {
            div.addEventListener("mousemove", this.onMouseMove);
            div.addEventListener("mousedown", this.onMouseDown);
            div.addEventListener("touchstart", this.onTouchStart);
            div.addEventListener("touchend", this.onTouchEnd);
            div.addEventListener("touchcancel", this.onTouchCancel);
            div.addEventListener("touchmove", this.onTouchMove);
            this.divListening = div;
        }
    }

    componentDidMount() {
        this.setListeners();
    }

    componentDidUpdate(prevProps, prevState) {
        if (this.divListening != this.div.current) {
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

        // clip cursor position to the app frame
        let x = clientX - rect.left;
        let y = clientY - rect.top;

        if (clip) {
            x = Math.min(Math.max(0, x), rect.width);
            y = Math.min(Math.max(0, y), rect.height);
        }

        return [x, y];
    }

    handleSelect(clientX, clientY) {
        const [selectedPointX, selectedPointY] = this.getLocalCoordinates(clientX, clientY);
        this.setState({ selectedPointX: selectedPointX, selectedPointY: selectedPointY });
    }

    handleMove(clientX, clientY) {
        const [currentPointX, currentPointY] = this.getLocalCoordinates(clientX, clientY);
        const { selectedPointX, selectedPointY } = this.state;
        const selected = isNum(selectedPointX) && isNum(selectedPointY);

        // callbacks
        if (!selected) {
            this.props.onPointHover && this.props.onPointHover(currentPointX, currentPointY);
        } else if (this.props.mouseMode == "pan") {
            this.props.onPan && this.props.onPan(currentPointX - selectedPointX, currentPointY - selectedPointY);
        }

        // update state
        this.setState({ currentPointX: currentPointX, currentPointY: currentPointY });
    }

    handleRelease(clientX, clientY) {
        const [releasePointX, releasePointY] = this.getLocalCoordinates(clientX, clientY);
        const { selectedPointX, selectedPointY, currentPointX, currentPointY } = this.state;
        const selected = isNum(selectedPointX) && isNum(selectedPointY);
        const delta = (releasePointX != selectedPointX) || (releasePointY != selectedPointY);

        // callbacks
        if (!delta) {
            this.props.onPointSelect && this.props.onPointSelect(releasePointX, releasePointY);
        } else if (this.props.mouseMode == "pan") {
            this.props.onPanRelease && this.props.onPanRelease();
        } else if (this.props.mouseMode == "box-select") {
            if (selected) {
                const box = this.boxGeometry(selectedPointX, selectedPointY, releasePointX, releasePointY);
                this.props.onBoxSelect && box.width && box.height && this.props.onBoxSelect(box);
            }
        }

        // update state
        this.setState({ selectedPointX: null, selectedPointY: null });
    }

    onMouseDown(e) {
        if (e.button == 0) {
            e.preventDefault();
            this.handleSelect(e.clientX, e.clientY);
        };
    }

    onMouseMove(e) {
        e.preventDefault();
        this.handleMove(e.clientX, e.clientY);
    }

    onMouseUp(e) {
        if (e.button == 0) {
            this.handleRelease(e.clientX, e.clientY);
        };
    }

    onTouchStart(e) {
        console.debug('touch start', e);
    }

    onTouchMove(e) {
        console.debug('touch move', e);
    }

    onTouchEnd(e) {
        console.debug('touch end', e);
    }

    onTouchCancel(e) {
        console.debug('touch cancel', e);
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
