package demo.observatory.weather;

/** The sky at one moment. */
public record Conditions(double temperatureC, double humidityPct, double windKmh, double cloudPct, Seeing seeing) {
    public static final Conditions CLEAR = new Conditions(12.0, 55.0, 6.0, 5.0, Seeing.GOOD);

    public boolean observable() {
        return cloudPct < 40 && windKmh < 30 && humidityPct < 90;
    }

    /** The dew point by the Magnus formula, in °C. */
    public double dewPointC() {
        double a = 17.62;
        double b = 243.12;
        double gamma = Math.log(humidityPct / 100) + a * temperatureC / (b + temperatureC);
        return b * gamma / (a - gamma);
    }
}
