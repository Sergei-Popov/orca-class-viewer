package demo.observatory.net;

import demo.observatory.imaging.FitsHeader;
import demo.observatory.imaging.FitsWriter;
import demo.observatory.imaging.Frame;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Uploads finished frames to the observatory's archive. */
public class ArchiveClient {
    public record Upload(String name, int bytes, int status) {
        public boolean stored() {
            return status == 201;
        }
    }

    private final Endpoint archive;
    private final Transport transport;
    private final Retry retry = new Retry(3, 500);
    private final List<Upload> history = new ArrayList<>();

    public ArchiveClient(Endpoint archive, Transport transport) {
        this.archive = archive;
        this.transport = transport;
    }

    public Upload upload(String name, Frame frame) throws IOException, InterruptedException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        new FitsWriter().write(frame, FitsHeader.of(frame), bytes);
        Request request = Request.put(archive.resolve(name), "application/fits", bytes.toByteArray());
        Response response = retry.run(() -> transport.send(request));
        Upload upload = new Upload(name, bytes.size(), response.status());
        history.add(upload);
        return upload;
    }

    public List<Upload> history() {
        return List.copyOf(history);
    }
}
