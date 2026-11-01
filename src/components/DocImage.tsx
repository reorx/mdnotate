/** Image status belongs outside annotatable text for every loading outcome. */
import { useEffect, useState } from 'react';
import type { DocKind } from '../lib/recent-docs';
import { imageSource, type ImageSession } from '../lib/doc-image';

export function DocImage({
  src = '',
  alt = '',
  width,
  height,
  kind,
  session,
  obsidian,
  reference,
}: {
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  kind: DocKind;
  session: ImageSession | null;
  obsidian: boolean;
  reference?: string;
}) {
  const [result, setResult] = useState<{ src?: string; error?: string }>({});
  useEffect(() => {
    let active = true;
    setResult({});
    async function load() {
      try {
        const source = imageSource(src, kind);
        if (source === 'remote') {
          if (active) setResult({ src });
          return;
        }
        if (source !== 'local' || !session) throw new Error('Local images require a local document in the desktop app');
        const url = await session.load(reference ?? decodeURIComponent(src), obsidian);
        if (active) setResult({ src: url });
      } catch (error) {
        if (active) setResult({ error: String(error instanceof Error ? error.message : error) });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [src, reference, kind, session, obsidian]);

  return (
    <span className="not-annotatable doc-image" contentEditable={false}>
      {result.src && !result.error ? (
        <img
          src={result.src}
          alt={alt}
          width={width}
          height={height}
          style={{
            maxWidth: '100%',
            height: 'auto',
            aspectRatio: width && height ? `${width} / ${height}` : undefined,
            objectFit: 'contain',
          }}
          onError={() => setResult({ error: 'Cannot decode image (damaged or unsupported format)' })}
        />
      ) : (
        <span role="status" className="text-neutral-500" title={src}>
          {result.error ? `Image unavailable: ${result.error}` : 'Loading image…'}
        </span>
      )}
    </span>
  );
}
