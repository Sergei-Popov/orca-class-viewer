package demo.observatory.telescope;

/** The aperture and focal length of the tube, in millimetres. */
public record Optics(double apertureMm, double focalLengthMm) {
    public double focalRatio() {
        return focalLengthMm / apertureMm;
    }

    public double magnification(Eyepiece eyepiece) {
        return focalLengthMm / eyepiece.focalLengthMm();
    }

    /** The faintest magnitude under a dark sky. */
    public double limitingMagnitude() {
        return 7.7 + 5 * Math.log10(apertureMm / 10.0);
    }

    /** The Dawes limit, in arcseconds. */
    public double resolutionArcsec() {
        return 116.0 / apertureMm;
    }
}
