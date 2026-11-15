package demo.observatory.weather;

/** The steadiness of the air, as the size of a star's blur in arcseconds. */
public enum Seeing {
    EXCELLENT(0.8), GOOD(1.5), AVERAGE(2.5), POOR(4.0);

    private final double arcsec;

    Seeing(double arcsec) {
        this.arcsec = arcsec;
    }

    public double arcsec() {
        return arcsec;
    }

    public static Seeing of(double arcsec) {
        for (Seeing s : values()) {
            if (arcsec <= s.arcsec) {
                return s;
            }
        }
        return POOR;
    }
}
