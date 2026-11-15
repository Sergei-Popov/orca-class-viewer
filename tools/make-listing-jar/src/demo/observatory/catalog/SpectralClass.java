package demo.observatory.catalog;

/** Harvard spectral classes, hottest first. */
public enum SpectralClass {
    O(30_000), B(10_000), A(7_500), F(6_000), G(5_200), K(3_700), M(2_400);

    private final int minTemperatureK;

    SpectralClass(int minTemperatureK) {
        this.minTemperatureK = minTemperatureK;
    }

    public int minTemperatureK() {
        return minTemperatureK;
    }

    public static SpectralClass of(char letter) {
        for (SpectralClass c : values()) {
            if (c.name().charAt(0) == Character.toUpperCase(letter)) {
                return c;
            }
        }
        throw new IllegalArgumentException("unknown spectral class: " + letter);
    }
}
