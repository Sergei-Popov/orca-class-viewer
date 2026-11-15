package demo.observatory.imaging;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The keyword cards of a FITS header, 80 characters each. */
public class FitsHeader {
    public record Card(String keyword, String value, String comment) {
        public Card {
            if (keyword.length() > 8) {
                throw new IllegalArgumentException("keyword longer than 8: " + keyword);
            }
        }

        public String line() {
            String text = String.format("%-8s= %20s / %s", keyword, value, comment);
            return text.length() > 80 ? text.substring(0, 80) : String.format("%-80s", text);
        }
    }

    private final Map<String, Card> cards = new LinkedHashMap<>();

    public FitsHeader put(String keyword, Object value, String comment) {
        cards.put(keyword, new Card(keyword, String.valueOf(value), comment));
        return this;
    }

    public static FitsHeader of(Frame frame) {
        return new FitsHeader()
                .put("SIMPLE", "T", "conforms to FITS")
                .put("BITPIX", 16, "bits per pixel")
                .put("NAXIS1", frame.width(), "width")
                .put("NAXIS2", frame.height(), "height")
                .put("EXPTIME", frame.exposure().seconds(), "seconds")
                .put("FILTER", "'" + frame.exposure().filter() + "'", "filter name");
    }

    public List<String> lines() {
        List<String> lines = new ArrayList<>();
        for (Card card : cards.values()) {
            lines.add(card.line());
        }
        lines.add(String.format("%-80s", "END"));
        return lines;
    }
}
