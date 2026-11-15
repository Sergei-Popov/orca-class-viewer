package demo.observatory.imaging;

/** Pixel counts per brightness, for stretching a frame on screen. */
public final class Histogram {
    public static final int BINS = 256;

    private final int[] counts = new int[BINS];
    private final int total;

    private Histogram(Frame frame) {
        for (short p : frame.pixels()) {
            counts[Short.toUnsignedInt(p) >>> 8]++;
        }
        total = frame.pixels().length;
    }

    public static Histogram of(Frame frame) {
        return new Histogram(frame);
    }

    /** The bin below which the given share of pixels lies. */
    public int percentile(double share) {
        long wanted = Math.round(total * share);
        long seen = 0;
        for (int bin = 0; bin < BINS; bin++) {
            seen += counts[bin];
            if (seen >= wanted) {
                return bin;
            }
        }
        return BINS - 1;
    }

    public int count(int bin) {
        return counts[bin];
    }
}
