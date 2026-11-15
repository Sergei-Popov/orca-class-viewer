package demo.observatory.imaging;

import java.io.DataOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Writes a frame as a FITS file: header blocks, then big-endian pixels. */
public class FitsWriter implements ImageSink {
    private static final int BLOCK = 2880;

    public FitsWriter() {}

    @Override
    public String extension() {
        return ".fits";
    }

    @Override
    public void write(Frame frame, FitsHeader header, OutputStream out) throws IOException {
        DataOutputStream data = new DataOutputStream(out);
        int written = 0;
        for (String line : header.lines()) {
            data.write(line.getBytes(StandardCharsets.US_ASCII));
            written += line.length();
        }
        pad(data, written, (byte) ' ');
        for (short p : frame.pixels()) {
            data.writeShort(p - Short.MIN_VALUE);
        }
        pad(data, frame.pixels().length * 2, (byte) 0);
        data.flush();
    }

    private static void pad(DataOutputStream data, int written, byte fill) throws IOException {
        for (int n = written; n % BLOCK != 0; n++) {
            data.writeByte(fill);
        }
    }
}
