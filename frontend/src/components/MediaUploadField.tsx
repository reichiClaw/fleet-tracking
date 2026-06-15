import { type ChangeEvent, type PointerEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '../api/errors';
import { uploadMedia, type MediaFile, type MediaType } from '../api/fleet';
import { ErrorState } from './ErrorState';

type MediaUploadFieldProps = {
  mediaType: MediaType;
  vehicleId?: string;
  loanId?: string;
  relatedType?: string;
  relatedId?: string;
  label: string;
  accept?: string;
  capture?: boolean;
  onUploaded: (media: MediaFile) => void;
};

export function MediaUploadField({
  mediaType,
  vehicleId,
  loanId,
  relatedType,
  relatedId,
  label,
  accept,
  capture,
  onUploaded,
}: MediaUploadFieldProps) {
  const { t } = useTranslation();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const media = await uploadMedia(file, {
        media_type: mediaType,
        vehicle: vehicleId,
        loan: loanId,
        related_type: relatedType,
        related_id: relatedId,
      });
      setUploadedName(media.original_filename || file.name);
      onUploaded(media);
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('media.uploadError')));
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  }

  return (
    <div className="media-field">
      <label>
        <span>{label}</span>
        <input
          accept={accept}
          capture={capture ? 'environment' : undefined}
          disabled={isUploading}
          type="file"
          onChange={handleChange}
        />
      </label>
      {uploadedName ? <p className="hint-text">{t('media.uploaded', { name: uploadedName })}</p> : null}
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}

type SignatureInputProps = Omit<MediaUploadFieldProps, 'mediaType' | 'label' | 'accept' | 'capture'> & {
  label: string;
};

export function SignatureInput(props: SignatureInputProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function beginDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }
    const { x, y } = pointerPosition(event);
    context.strokeStyle = '#18212f';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(x, y);
    setIsDrawing(true);
    canvas.setPointerCapture(event.pointerId);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) {
      return;
    }
    const context = canvasRef.current?.getContext('2d');
    if (!context) {
      return;
    }
    const { x, y } = pointerPosition(event);
    context.lineTo(x, y);
    context.stroke();
  }

  function endDrawing() {
    setIsDrawing(false);
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    setUploadedName(null);
  }

  async function uploadSignature() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) {
        throw new Error('signature');
      }
      const file = new File([blob], 'signature.png', { type: 'image/png' });
      const media = await uploadMedia(file, {
        media_type: 'signature',
        vehicle: props.vehicleId,
        loan: props.loanId,
        related_type: props.relatedType,
        related_id: props.relatedId,
      });
      setUploadedName(media.original_filename || file.name);
      props.onUploaded(media);
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('media.uploadError')));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="signature-field">
      <span className="field-label">{props.label}</span>
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        width="640"
        height="220"
        aria-label={props.label}
        onPointerDown={beginDrawing}
        onPointerMove={draw}
        onPointerUp={endDrawing}
        onPointerCancel={endDrawing}
      />
      <div className="action-row">
        <button className="secondary-button" type="button" onClick={clearSignature}>
          {t('media.clearSignature')}
        </button>
        <button type="button" disabled={isUploading} onClick={uploadSignature}>
          {isUploading ? t('media.uploading') : t('media.saveSignature')}
        </button>
      </div>
      <MediaUploadField {...props} mediaType="signature" accept="image/*" label={t('media.signatureFallback')} />
      {uploadedName ? <p className="hint-text">{t('media.uploaded', { name: uploadedName })}</p> : null}
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}
