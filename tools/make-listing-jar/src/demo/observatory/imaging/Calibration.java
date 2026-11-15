package demo.observatory.imaging;

/** Removes the sensor's dark current and the optics' vignetting from a frame. */
public class Calibration {
    private final Frame dark;
    private final Frame flat;
    private final double flatMean;

    public Calibration(Frame dark, Frame flat) {
        this.dark = dark;
        this.flat = flat;
        this.flatMean = flat.mean();
    }

    public Frame apply(Frame light) {
        short[] out = new short[light.pixels().length];
        for (int i = 0; i < out.length; i++) {
            int signal = Short.toUnsignedInt(light.pixels()[i]) - Short.toUnsignedInt(dark.pixels()[i]);
            int gain = Math.max(1, Short.toUnsignedInt(flat.pixels()[i]));
            int value = (int) Math.round(Math.max(0, signal) * flatMean / gain);
            out[i] = (short) Math.min(0xFFFF, value);
        }
        return new Frame(light.width(), light.height(), light.exposure(), out);
    }
}
