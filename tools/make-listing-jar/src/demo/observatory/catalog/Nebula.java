package demo.observatory.catalog;

public record Nebula(String name, double apparentMagnitude, Coordinates position, double sizeArcmin, boolean planetary)
        implements CelestialBody {
    /** Surface brightness in magnitudes per square arcminute. */
    public double surfaceBrightness() {
        double area = Math.PI * sizeArcmin * sizeArcmin / 4;
        return apparentMagnitude + 2.5 * Math.log10(area);
    }
}
