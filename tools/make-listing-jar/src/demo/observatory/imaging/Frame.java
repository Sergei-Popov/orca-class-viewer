package demo.observatory.imaging;

/** One exposure from the camera, 16 bits per pixel. */
public record Frame(int width, int height, Exposure exposure, short[] pixels) {
    public Frame {
        if (pixels.length != width * height) {
            throw new IllegalArgumentException(width + "×" + height + " frame with " + pixels.length + " pixels");
        }
    }

    public int pixel(int x, int y) {
        return Short.toUnsignedInt(pixels[y * width + x]);
    }

    public double mean() {
        long sum = 0;
        for (short p : pixels) {
            sum += Short.toUnsignedInt(p);
        }
        return pixels.length == 0 ? 0 : (double) sum / pixels.length;
    }

    public static Frame blank(int width, int height, Exposure exposure) {
        return new Frame(width, height, exposure, new short[width * height]);
    }
}
