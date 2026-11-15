package demo.observatory.imaging;

import java.io.IOException;
import java.io.OutputStream;

/** Where finished frames go. */
public interface ImageSink {
    String extension();

    void write(Frame frame, FitsHeader header, OutputStream out) throws IOException;
}
