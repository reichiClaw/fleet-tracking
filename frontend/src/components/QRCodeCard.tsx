import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

type QRCodeCardProps = {
  title: string;
  description?: string;
  value: string;
};

export function QRCodeCard({ title, description, value }: QRCodeCardProps) {
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
      <div>
        <h3>{title}</h3>
        {description ? <p className="hint-text">{description}</p> : null}
      </div>
      {imageUrl ? <img alt={title} src={imageUrl} /> : null}
      <code>{value}</code>
    </article>
  );
}
