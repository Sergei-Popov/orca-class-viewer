package demo.observatory.catalog;

import java.util.List;

/** Reads stars from comma-separated lines: name, magnitude, RA hours, Dec degrees, class, distance. */
public final class CatalogLoader {
    private static final String BUILT_IN = """
            name,magnitude,ra,dec,class,distance
            Vega,0.03,18.6156,38.7837,A,25.04
            Altair,0.76,19.8464,8.8683,A,16.73
            Deneb,1.25,20.6905,45.2803,A,2615
            Arcturus,-0.05,14.2610,19.1825,K,36.7
            Capella,0.08,5.2782,45.9980,G,42.9
            Aldebaran,0.87,4.5987,16.5093,K,65.3
            """;

    private CatalogLoader() {}

    public static Catalog<Star> builtIn() {
        try {
            return parse(BUILT_IN);
        } catch (CatalogException e) {
            throw new IllegalStateException("built-in catalog", e);
        }
    }

    public static Catalog<Star> parse(String csv) throws CatalogException {
        Catalog<Star> catalog = new Catalog<>();
        List<String> lines = csv.lines().toList();
        for (int i = 1; i < lines.size(); i++) {
            String line = lines.get(i).strip();
            if (!line.isEmpty() && !line.startsWith("#")) {
                catalog.add(parseLine(line, i + 1));
            }
        }
        return catalog;
    }

    static Star parseLine(String line, int number) throws CatalogException {
        String[] cells = line.split(",");
        if (cells.length != 6) {
            throw new CatalogException(number, "expected 6 cells, found " + cells.length);
        }
        try {
            Coordinates position = new Coordinates(Double.parseDouble(cells[2]), Double.parseDouble(cells[3]));
            SpectralClass spectralClass = SpectralClass.of(cells[4].charAt(0));
            return new Star(cells[0], Double.parseDouble(cells[1]), position, spectralClass, Double.parseDouble(cells[5]));
        } catch (IllegalArgumentException e) {
            throw new CatalogException(number, e.getMessage());
        }
    }
}
