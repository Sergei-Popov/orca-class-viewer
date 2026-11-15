package demo.observatory.weather;

import java.util.ArrayList;
import java.util.List;

/** A reason to close the dome or warm the optics. */
public sealed interface Alert {
    String message();

    record Wind(double kmh) implements Alert {
        @Override
        public String message() {
            return "wind " + kmh + " km/h: close the dome";
        }
    }

    record Dew(double marginC) implements Alert {
        @Override
        public String message() {
            return "dew in " + marginC + " °C: turn the heaters on";
        }
    }

    record Cloud(double pct) implements Alert {
        @Override
        public String message() {
            return pct + "% cloud";
        }
    }

    static List<Alert> check(Conditions sky) {
        List<Alert> alerts = new ArrayList<>();
        if (sky.windKmh() >= 30) {
            alerts.add(new Wind(sky.windKmh()));
        }
        double margin = sky.temperatureC() - sky.dewPointC();
        if (margin < 2) {
            alerts.add(new Dew(margin));
        }
        if (sky.cloudPct() >= 40) {
            alerts.add(new Cloud(sky.cloudPct()));
        }
        return alerts;
    }
}
