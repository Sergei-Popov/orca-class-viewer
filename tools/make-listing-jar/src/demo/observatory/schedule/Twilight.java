package demo.observatory.schedule;

/** How far the sun is below the horizon. */
public enum Twilight {
    CIVIL(-6) {
        @Override
        public String describe() {
            return "bright planets only";
        }
    },
    NAUTICAL(-12) {
        @Override
        public String describe() {
            return "bright stars and clusters";
        }
    },
    ASTRONOMICAL(-18) {
        @Override
        public String describe() {
            return "dark enough for galaxies";
        }
    };

    private final int sunAltitudeDeg;

    Twilight(int sunAltitudeDeg) {
        this.sunAltitudeDeg = sunAltitudeDeg;
    }

    public int sunAltitudeDeg() {
        return sunAltitudeDeg;
    }

    public abstract String describe();
}
