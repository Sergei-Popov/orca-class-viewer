package demo.observatory.weather;

import demo.observatory.net.Endpoint;
import demo.observatory.net.Request;
import demo.observatory.net.Response;
import demo.observatory.net.Transport;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Fetches the night's forecast, or assumes a clear sky offline. */
public class WeatherService {
    private final Endpoint endpoint;
    private Forecast cached;

    public WeatherService(Endpoint endpoint) {
        this.endpoint = endpoint;
    }

    public Forecast fetch(Transport transport) throws IOException {
        Response response = transport.send(Request.get(endpoint));
        if (!response.ok()) {
            throw new IOException(endpoint.host() + " answered " + response.status());
        }
        cached = parse(response.text());
        return cached;
    }

    /** Lines of "hour,temperature,humidity,wind,cloud,seeing". */
    static Forecast parse(String text) {
        List<Forecast.Hour> hours = new ArrayList<>();
        for (String line : text.split("\n")) {
            String[] c = line.split(",");
            if (c.length == 6) {
                Conditions conditions = new Conditions(Double.parseDouble(c[1]), Double.parseDouble(c[2]),
                        Double.parseDouble(c[3]), Double.parseDouble(c[4]), Seeing.of(Double.parseDouble(c[5])));
                hours.add(new Forecast.Hour(Integer.parseInt(c[0]), conditions));
            }
        }
        return new Forecast(hours);
    }

    public Conditions tonight() {
        if (cached == null || cached.hours().isEmpty()) {
            return Conditions.CLEAR;
        }
        return cached.bestHour().map(Forecast.Hour::conditions).orElse(cached.hours().get(0).conditions());
    }
}
