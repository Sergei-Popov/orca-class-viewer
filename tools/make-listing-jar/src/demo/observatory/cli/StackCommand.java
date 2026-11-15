package demo.observatory.cli;

import demo.observatory.Observatory;
import demo.observatory.imaging.Exposure;
import demo.observatory.imaging.Frame;
import demo.observatory.imaging.Stacker;
import java.util.List;

/** stack FRAME...: combine frames with the chosen method. */
public record StackCommand(List<String> frames, Stacker.Method method) implements Command {
    public StackCommand {
        frames = List.copyOf(frames);
    }

    @Override
    public String name() {
        return "stack";
    }

    @Override
    public ExitCode run(Observatory observatory, Console console) {
        if (frames.size() < 2) {
            console.error("stack needs at least two frames");
            return ExitCode.USAGE;
        }
        Stacker stacker = new Stacker(method);
        for (int i = 0; i < frames.size(); i++) {
            stacker.add(Frame.blank(64, 64, Exposure.of(120, "L")));
        }
        Frame result = stacker.stack();
        console.println(frames.size() + " frames, " + method + ": " + result.exposure().seconds() + " s in all");
        return ExitCode.OK;
    }
}
