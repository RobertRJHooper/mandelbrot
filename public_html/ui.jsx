"use strict";

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

        this.onBoxSelection = this.onBoxSelection.bind(this);
        this.onPointHover = this.onPointHover.bind(this);
        this.onInfoButtonClick = () => this.setState({ infoModalVisible: !this.state.infoModalVisible });
        this.onInfoCloseClick = () => this.setState({ infoModalVisible: false });
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
        const {
            center,
            width,
            height,
            zoom,
            sample,
            sampleVisible,
            infoModalVisible,
        } = this.state;

        return (
            <div>
                <MandelbrotSet
                    center={center}
                    zoom={zoom}
                    width={width}
                    height={height}
                />

                {sampleVisible ?
                    <SampleDisplay
                        center={center}
                        zoom={zoom}
                        width={width}
                        height={height}
                        sample={sample}
                    />
                    :
                    <div></div>
                }

                <Selector
                    onPointHover={this.onPointHover}
                    onBoxSelection={this.onBoxSelection}
                />

                <Navbar
                    onResetClick={() => this.setState({ ...App.defaultView, infoModalVisible: false })}

                    sampleActivated={sampleVisible}
                    onSampleToggle={() => this.setState({ sampleVisible: !this.state.sampleVisible })}

                    workInProgress="1"
                    onInfoButtonClick={this.onInfoButtonClick}
                />

                <InfoModal
                    visible={infoModalVisible}
                    onCloseClick={this.onInfoCloseClick}
                />
            </div>
        );
    }

    componentDidMount() {
        this.resizeObserver.observe(this.container.current);
        this.pullContainerDimensions();
    }

    componentDidUpdate(prevProps, prevState) {
        const { center, zoom } = this.state;

        // push view to url
        if (prevState.center != center || prevState.zoom != zoom) {
            this.pushURL(center, zoom);
        }
    }

    componentWillUnmount() {
        this.resizeObserver.disconnect();
    }

    onBoxSelection(box) {
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
            }
        });
    }

    onPointHover(x, y) {
        this.setState((state, props) => {
            const { center, zoom, width, height } = state;

            const point = rectToImaginary(
                center,
                zoom,
                width,
                height,
                x,
                y
            );

            return { sample: mbSample(point) };
        });
    }
}

class MandelbrotSet extends React.Component {
    static frameThrottle = 5;
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

        this.state = {
            setupFlag: false,
            modelClientFlag: 0,
        }

        this.canvas = React.createRef();
        this.model = new ModelClient();
        this.model.onUpdate = () => this.setState((state, props) => ({ modelClientFlag: state.modelClientFlag + 1 }));
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

    draw(snaps, canvasOffsetX, canvasOffsetY, update) {
        const { width, height } = this.props;

        const canvas = this.canvas.current;
        const context = canvas.getContext('2d');

        // clear canvas
        if (!update) {
            context.beginPath();
            context.fillStyle = "grey";
            context.fillRect(0, 0, canvas.width, canvas.height);
        }

        // render each panel to canvas
        for (const snap of snaps) {
            const { bitmap, canvasX, canvasY } = snap;

            const x = canvasOffsetX + canvasX;
            const y = canvasOffsetY + canvasY;

            // check the snap is on canvas
            const outside = x + bitmap.width < 0 || x >= width
                || y + bitmap.height < 0 || y >= height;

            if (!outside) {
                context.drawImage(bitmap, x, y);
            }
        };
    }

    componentDidMount() {
        this.model.initiate();
        this.setState({ setupFlag: true });
    }

    componentDidUpdate(prevProps, prevState) {
        const { zoom, center, width, height } = this.props;
        const { setupFlag, modelClientFlag } = this.state;
        const { model } = this;

        // console.log('state', this.state, prevState);
        // console.log('props', this.props, prevProps);
        const setup = setupFlag != prevState.setupFlag;

        if (zoom != prevProps.zoom || setup) {
            console.debug('update to zoom level', zoom);
            this.draw([], 0, 0, false);
            model.setZoom(zoom);
            model.resetBudget();
        }

        // set center point
        if (center != prevProps.center || width != prevProps.width || height != prevProps.height || setup) {
            console.debug('update to center, width or height', center, width, height);
            model.setCenter(center, width, height);
            this.draw(model.full(), model.canvasOffsetX, model.canvasOffsetY, false);
        }

        // process new snaps
        if (modelClientFlag != prevState.modelClientFlag) {
            this.draw(model.flush(), model.canvasOffsetX, model.canvasOffsetY, true);
            model.resetBudget();
        }
    }

    componentWillUnmount() {
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

// class to handle zooming, selecting, hovering
class Selector extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            clickedX: null,
            clickedY: null,
            currentX: null,
            currentY: null,
        }

        this.div = React.createRef();
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
    }

    render() {
        const { clickedX, clickedY, currentX, currentY } = this.state;

        const showBox = clickedX && clickedY && currentX && currentY;
        const box = showBox && this.boxGeometry(clickedX, clickedY, currentX, currentY);

        return (
            <div ref={this.div}
                className="selector"
                onMouseDown={this.onMouseDown}
                onMouseUp={this.onMouseUp}
            >
                <div
                    className="selector-box"
                    style={showBox ? { ...box, visibility: "visible" } : { visibility: "hidden" }
                    }>
                </div>
            </div>
        );
    }

    componentDidMount() {
        window.addEventListener("mousemove", this.onMouseMove);
        window.addEventListener("mouseup", this.onMouseUp);
    }

    componentDidUpdate(prevProps, prevState) {
        const { onPointHover, onBoxSelection } = this.props;
        const { currentX, currentY, clickedX, clickedY } = this.state;

        const isNum = Number.isFinite
        const current = isNum(currentX) && isNum(currentY);
        const clicked = isNum(clickedX) && isNum(clickedY);
        const prevClicked = isNum(prevState.clickedX) && isNum(prevState.clickedY);

        // hover callback
        if (onPointHover && current && !clicked) {
            if (currentX != prevState.currentX || currentY != prevState.currentY) {
                onPointHover(currentX + 0, currentY + 0);
            }
        }

        // box selection callback
        if (onBoxSelection && current && !clicked && prevClicked) {
            onBoxSelection(this.boxGeometry(
                prevState.clickedX,
                prevState.clickedY,
                currentX,
                currentY
            ));
        }
    }

    componentWillUnmount() {
        window.removeEventListener("mousemove", this.onMouseMove);
        window.removeEventListener("mouseup", this.onMouseUp);
    }

    // get box dimensions maintaining aspect ration of div container
    // the box has the usual rectangle coordinate system (vertical increasing downwards)
    boxGeometry(clickedX, clickedY, currentX, currentY) {
        const rect = {
            left: clickedX,
            top: clickedY,
            width: currentX - clickedX,
            height: currentY - clickedY,
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

    onMouseMove(e) {
        const rect = this.div.current.getBoundingClientRect();

        // clip cursor position to the app frame
        const clientX = Math.min(Math.max(rect.left, e.clientX), rect.right);
        const clientY = Math.min(Math.max(rect.top, e.clientY), rect.bottom);

        this.setState({
            currentX: clientX - rect.left,
            currentY: clientY - rect.top,
        });
    }

    onMouseDown(e) {
        if (e.button == 0) {
            const rect = this.div.current.getBoundingClientRect();

            this.setState({
                clickedX: e.clientX - rect.left,
                clickedY: e.clientY - rect.top,
            });
        }
    }

    onMouseUp(e) {
        this.setState({
            clickedX: null,
            clickedY: null,
        });
    }
}

class Navbar extends React.Component {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <div className="navbar">
                <div className="navbar-item"
                    onMouseDown={() => this.setState({ highlightResetButton: true })}
                    onMouseUp={() => this.setState({ highlightResetButton: false })}
                    onClick={this.props.onResetClick}>
                    {/* house icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L8 2.207l6.646 6.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z" />
                        <path d="m8 3.293 6 6V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5V9.293l6-6Z" />
                    </svg>
                </div>
                <div className={this.props.sampleButtonActivated ? "navbar-item navbar-item-active" : "navbar-item"}
                    onClick={this.props.onSampleToggle}>
                    {/* cursor icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                        <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z" />
                    </svg>
                </div>
                <div className="navbar-item">
                    <div className={this.props.workInProgress ? "navbar-icon-working" : ""}>
                        {/* fan icon */}
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="navbar-icon" viewBox="0 0 16 16">
                            <path d="M10 3c0 1.313-.304 2.508-.8 3.4a1.991 1.991 0 0 0-1.484-.38c-.28-.982-.91-2.04-1.838-2.969a8.368 8.368 0 0 0-.491-.454A5.976 5.976 0 0 1 8 2c.691 0 1.355.117 1.973.332.018.219.027.442.027.668Zm0 5c0 .073-.004.146-.012.217 1.018-.019 2.2-.353 3.331-1.006a8.39 8.39 0 0 0 .57-.361 6.004 6.004 0 0 0-2.53-3.823 9.02 9.02 0 0 1-.145.64c-.34 1.269-.944 2.346-1.656 3.079.277.343.442.78.442 1.254Zm-.137.728a2.007 2.007 0 0 1-1.07 1.109c.525.87 1.405 1.725 2.535 2.377.2.116.402.222.605.317a5.986 5.986 0 0 0 2.053-4.111c-.208.073-.421.14-.641.199-1.264.339-2.493.356-3.482.11ZM8 10c-.45 0-.866-.149-1.2-.4-.494.89-.796 2.082-.796 3.391 0 .23.01.457.027.678A5.99 5.99 0 0 0 8 14c.94 0 1.83-.216 2.623-.602a8.359 8.359 0 0 1-.497-.458c-.925-.926-1.555-1.981-1.836-2.96-.094.013-.191.02-.29.02ZM6 8c0-.08.005-.16.014-.239-1.02.017-2.205.351-3.34 1.007a8.366 8.366 0 0 0-.568.359 6.003 6.003 0 0 0 2.525 3.839 8.37 8.37 0 0 1 .148-.653c.34-1.267.94-2.342 1.65-3.075A1.988 1.988 0 0 1 6 8Zm-3.347-.632c1.267-.34 2.498-.355 3.488-.107.196-.494.583-.89 1.07-1.1-.524-.874-1.406-1.733-2.541-2.388a8.363 8.363 0 0 0-.594-.312 5.987 5.987 0 0 0-2.06 4.106c.206-.074.418-.14.637-.199ZM8 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
                            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14Zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16Z" />
                        </svg>
                    </div>
                </div>
                <div className="navbar-item"
                    onClick={() => this.props.onInfoButtonClick()}>
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
