package demo.observatory.weather;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/** Hourly conditions for the coming night. */
public class Forecast {
    public record Hour(int hour, Conditions conditions) {}

    private final List<Hour> hours;

    public Forecast(List<Hour> hours) {
        this.hours = List.copyOf(hours);
    }

    public List<Hour> observableHours() {
        return hours.stream().filter(h -> h.conditions().observable()).toList();
    }

    public Optional<Hour> bestHour() {
        return observableHours().stream()
                .min(Comparator.comparingDouble((Hour h) -> h.conditions().seeing().arcsec())
                        .thenComparingDouble(h -> h.conditions().cloudPct()));
    }

    public List<Hour> hours() {
        return hours;
    }
}
