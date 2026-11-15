/** A fictional observatory toolkit: the demo jar of Class File Viewer's listing images. */
module demo.observatory {
    requires java.logging;

    exports demo.observatory;
    exports demo.observatory.catalog;
    exports demo.observatory.cli;
    exports demo.observatory.imaging;
    exports demo.observatory.net;
    exports demo.observatory.schedule;
    exports demo.observatory.telescope;
    exports demo.observatory.util;
    exports demo.observatory.weather;

    uses demo.observatory.imaging.ImageSink;
    provides demo.observatory.imaging.ImageSink with demo.observatory.imaging.FitsWriter;
}
