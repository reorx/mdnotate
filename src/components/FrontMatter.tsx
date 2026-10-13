import { useMemo } from 'react';
import { parseFrontMatter } from '../lib/front-matter';

/** Metadata stays in the article, so selecting, searching and annotating its
 * values works just like prose. Only the interface label is excluded. */
export function FrontMatter({ yaml }: { yaml: string }) {
  const fields = useMemo(() => parseFrontMatter(yaml), [yaml]);
  if (!yaml.trim()) return null;

  return (
    <section className="front-matter" aria-label="Front matter">
      <div className="front-matter-label not-annotatable">Front matter</div>
      {fields ? (
        <dl className="front-matter-fields">
          {fields.map(({ key, value, structured }) => (
            <div className="front-matter-field" key={key}>
              <dt>{key}</dt>
              <dd className={structured ? 'front-matter-structured' : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre><code>{yaml}</code></pre>
      )}
    </section>
  );
}
