package demo.observatory.imaging;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Combines aligned frames into one with less noise. */
public class Stacker {
    public enum Method { MEAN, MEDIAN, SIGMA_CLIP }

    private final Method method;
    private final List<Frame> frames = new ArrayList<>();

    public Stacker(Method method) {
        this.method = method;
    }

    public void add(Frame frame) {
        if (!frames.isEmpty() && (frame.width() != frames.get(0).width() || frame.height() != frames.get(0).height())) {
            throw new IllegalArgumentException("frame size differs from the first frame");
        }
        frames.add(frame);
    }

    public Frame stack() {
        if (frames.isEmpty()) {
            throw new IllegalStateException("nothing to stack");
        }
        Frame first = frames.get(0);
        short[] out = new short[first.pixels().length];
        int[] column = new int[frames.size()];
        for (int i = 0; i < out.length; i++) {
            for (int f = 0; f < column.length; f++) {
                column[f] = Short.toUnsignedInt(frames.get(f).pixels()[i]);
            }
            int value = switch (method) {
                case MEAN -> mean(column);
                case MEDIAN -> median(column);
                case SIGMA_CLIP -> clipped(column, 2.5);
            };
            out[i] = (short) value;
        }
        double seconds = frames.stream().mapToDouble(f -> f.exposure().seconds()).sum();
        Exposure sum = new Exposure(seconds, first.exposure().gain(), first.exposure().filter(), first.exposure().start());
        return new Frame(first.width(), first.height(), sum, out);
    }

    static int mean(int[] values) {
        long sum = 0;
        for (int v : values) {
            sum += v;
        }
        return (int) (sum / values.length);
    }

    static int median(int[] values) {
        int[] sorted = values.clone();
        Arrays.sort(sorted);
        return sorted[sorted.length / 2];
    }

    static int clipped(int[] values, double sigmas) {
        double mean = mean(values);
        double variance = Arrays.stream(values).mapToDouble(v -> (v - mean) * (v - mean)).average().orElse(0);
        double limit = sigmas * Math.sqrt(variance);
        return (int) Arrays.stream(values).filter(v -> Math.abs(v - mean) <= limit).average().orElse(mean);
    }
}
