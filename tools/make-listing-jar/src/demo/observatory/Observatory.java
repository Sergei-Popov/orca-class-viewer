package demo.observatory;

import demo.observatory.catalog.Catalog;
import demo.observatory.catalog.CatalogLoader;
import demo.observatory.catalog.Star;
import demo.observatory.net.ArchiveClient;
import demo.observatory.net.NetConfig;
import demo.observatory.schedule.Scheduler;
import demo.observatory.telescope.EquatorialMount;
import demo.observatory.telescope.Optics;
import demo.observatory.weather.WeatherService;

/** A site: its telescope and star catalog, the weather it watches and the archive it uploads to. */
public final class Observatory {
    public static final String DEFAULT_SITE = "Ridge Field Station";
    public static final double DEFAULT_LATITUDE_DEG = 41.2;

    private final String site;
    private final Telescope telescope;
    private final Catalog<Star> stars;
    private final WeatherService weather;
    private final ArchiveClient archive;

    public Observatory(String site, Telescope telescope, Catalog<Star> stars, WeatherService weather, ArchiveClient archive) {
        this.site = site;
        this.telescope = telescope;
        this.stars = stars;
        this.weather = weather;
        this.archive = archive;
    }

    public static Observatory defaults() {
        NetConfig net = NetConfig.defaults();
        Telescope telescope = new Telescope("Ridge-8", new Optics(203.2, 1200.0), new EquatorialMount(DEFAULT_LATITUDE_DEG));
        return new Observatory(DEFAULT_SITE, telescope, CatalogLoader.builtIn(),
                new WeatherService(net.weather()), new ArchiveClient(net.archive(), net.transport()));
    }

    public Scheduler scheduler() {
        return new Scheduler(weather.tonight());
    }

    public String site() {
        return site;
    }

    public Telescope telescope() {
        return telescope;
    }

    public Catalog<Star> stars() {
        return stars;
    }

    public WeatherService weather() {
        return weather;
    }

    public ArchiveClient archive() {
        return archive;
    }
}
