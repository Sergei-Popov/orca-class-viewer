package demo.observatory.catalog;

public record Comet(String name, double apparentMagnitude, Coordinates position, double periodYears)
        implements CelestialBody {
    public boolean periodic() {
        return periodYears > 0 && periodYears < 200;
    }
}
