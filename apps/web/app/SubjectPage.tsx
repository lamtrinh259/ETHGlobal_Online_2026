import { InstanceAnswers } from "@/app/InstanceAnswers";
import { createApi } from "@/lib/api";
import type { WebConfig } from "@/lib/config";
import { flourish } from "@/lib/patience";

/**
 * A subject's page, from its own records.
 *
 * `kju-is` is a name domain, one label under the root like a person's name, and a reader who types
 * `/p/kju-is` means the subject — who it is about, what it asks, what people have answered — not a
 * person called that who holds nothing. It is the same page `/v/kju-is.<root>` renders, from the same
 * Multipass and ENS records: the instance's `name`, `description`, `avatar` and `url` texts, and every
 * live answer under it. One rendering, reached by either address.
 */
export async function SubjectPage({
  instance,
  config,
}: {
  instance: WebConfig["instances"][number];
  config: WebConfig;
}) {
  const api = createApi(config.apiUrl, config.attestUrl);
  const [data, ens] = await Promise.all([
    api.instance(instance.domain).catch(() => null),
    api.ens(instance.parentName, undefined, { signal: flourish() }).catch(() => null),
  ]);
  if (!data) {
    return (
      <section className="card" data-testid="subject-unread">
        <h2>{instance.parentName}</h2>
        <p className="warning">
          The subject could not be read just now. Its records are on chain either way; try again shortly.
        </p>
      </section>
    );
  }
  return <InstanceAnswers data={data} texts={ens?.texts} />;
}
