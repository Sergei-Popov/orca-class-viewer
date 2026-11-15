package demo.observatory.util;

import java.util.Locale;

/** Conversions between the units of an observing log. The Java 17 build of the class. */
public final class Units {
    public static final double LIGHT_YEAR_KM = 9.4607e12;
    public static final double AU_KM = 1.495978707e8;
    public static final double PARSEC_LY = 3.26156;
    public static final long SECONDS_PER_DAY = 86_400L;
    public static final int ARCSEC_PER_DEGREE = 3_600;
    public static final String DISTANCE_UNIT = "ly";

    private Units() {}

    public static double toKilometres(double lightYears) {
        return lightYears * LIGHT_YEAR_KM;
    }

    public static double toParsecs(double lightYears) {
        return lightYears / PARSEC_LY;
    }

    public static double auToKilometres(double au) {
        return au * AU_KM;
    }

    public static double arcsecToDegrees(double arcsec) {
        return arcsec / ARCSEC_PER_DEGREE;
    }

    public static String formatDistance(double lightYears) {
        return lightYears < 1
                ? String.format(Locale.ROOT, "%.0f AU", lightYears * LIGHT_YEAR_KM / AU_KM)
                : String.format(Locale.ROOT, "%.1f %s", lightYears, DISTANCE_UNIT);
    }

    /** 41.2794 is 41° 16′ 46″. */
    public static String formatAngle(double degrees) {
        var total = Math.round(Math.abs(degrees) * ARCSEC_PER_DEGREE);
        var sign = degrees < 0 ? "-" : "";
        return String.format(Locale.ROOT, "%s%d° %02d′ %02d″", sign, total / 3600, total / 60 % 60, total % 60);
    }

    /** Days, hours, minutes and seconds of a duration in seconds. */
    public static long[] split(long seconds) {
        return new long[] {seconds / SECONDS_PER_DAY, seconds % SECONDS_PER_DAY / 3600, seconds % 3600 / 60, seconds % 60};
    }

    public static String describe(Object value) {
        if (value instanceof Double lightYears) {
            return formatDistance(lightYears);
        }
        return value + " " + DISTANCE_UNIT;
    }
}
