import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

type QRCodeCardProps = {
  title: string;
  description?: string;
  value: string;
  humanReadableValue?: string;
  showHeader?: boolean;
};

export function QRCodeCard({
  title,
  description,
  value,
  humanReadableValue,
  showHeader = true,
}: QRCodeCardProps) {
  const [imageUrl, setImageUrl] = useState('');

  useEffect(() => {
    let isMounted = true;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 6,
      color: {
        dark: '#18212f',
        light: '#ffffff',
      },
    }).then((nextImageUrl) => {
      if (isMounted) {
        setImageUrl(nextImageUrl);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [value]);

  return (
    <article className="qr-card">
      {showHeader ? (
        <div>
          <h3>{title}</h3>
          {description ? <p className="hint-text">{description}</p> : null}
        </div>
      ) : null}
      {imageUrl ? <img alt={title} src={imageUrl} /> : null}
      {humanReadableValue ? <code className="qr-card__plain-value">{humanReadableValue}</code> : null}
      <code className="qr-card__encoded-value">{value}</code>
    </article>
  );
}
