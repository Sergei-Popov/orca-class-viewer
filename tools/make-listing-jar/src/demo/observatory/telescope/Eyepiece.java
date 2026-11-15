package demo.observatory.telescope;

public record Eyepiece(String label, double focalLengthMm, double apparentFieldDeg) {
    /** The patch of sky this eyepiece shows on a tube, in degrees. */
    public double trueFieldDeg(Optics optics) {
        return apparentFieldDeg / optics.magnification(this);
    }
}
