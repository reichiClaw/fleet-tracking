import {
  type ChangeEvent,
  type PointerEvent,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '../api/errors';
import { discardMedia, mediaDownloadUrl, uploadMedia, type MediaFile, type MediaType } from '../api/fleet';
import { ErrorState } from './ErrorState';

const attachedMediaIds = new Set<string>();

export function markMediaAttached(ids: string[]) {
  ids.forEach((id) => attachedMediaIds.add(id));
}

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
  onRemoved?: (media: MediaFile) => void;
  submitted?: boolean;
  validationError?: string;
  validationErrorId?: string;
  required?: boolean;
  /** Keep staged files when a wizard step unmounts; the workflow draft owns cleanup. */
  preserveOnUnmount?: boolean;
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
  onRemoved,
  submitted = false,
  validationError,
  validationErrorId: providedValidationErrorId,
  required,
  preserveOnUnmount = false,
}: MediaUploadFieldProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const validationErrorId = providedValidationErrorId ?? `${inputId}-error`;
  const [isUploading, setIsUploading] = useState(false);
  const [uploads, setUploads] = useState<MediaFile[]>([]);
  const [lastFailedFile, setLastFailedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadsRef = useRef<MediaFile[]>([]);
  const submittedRef = useRef(submitted);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  useEffect(() => {
    submittedRef.current = submitted;
  }, [submitted]);

  useEffect(() => () => {
    if (!submittedRef.current && !preserveOnUnmount) {
      uploadsRef.current
        .filter((media) => !attachedMediaIds.has(media.id))
        .forEach((media) => void discardMedia(media.id).catch(() => undefined));
    }
  }, [preserveOnUnmount]);

  async function upload(file: File) {
    setIsUploading(true);
    setError(null);
    try {
      if (mediaType !== 'photo' && mediaType !== 'signature') {
        throw new Error('Unsupported staged media type.');
      }
      const media = await uploadMedia(file, { media_type: mediaType });
      setUploads((current) => [...current, media]);
      setLastFailedFile(null);
      onUploaded(media);
    } catch (uploadError) {
      setLastFailedFile(file);
      setError(getApiErrorMessage(uploadError, t, t('media.uploadError')));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await upload(file);
    event.target.value = '';
  }

  async function removeUpload(media: MediaFile) {
    setError(null);
    try {
      await discardMedia(media.id);
      setUploads((current) => current.filter((item) => item.id !== media.id));
      onRemoved?.(media);
    } catch (removeError) {
      setError(getApiErrorMessage(removeError, t, t('media.discardError')));
    }
  }

  return (
    <div className="media-field">
      <label>
        <span>{label}{required ? <span className="required-marker" aria-hidden="true"> *</span> : null}</span>
        <input
          id={inputId}
          accept={accept}
          aria-label={label}
          aria-describedby={validationError ? validationErrorId : undefined}
          aria-invalid={Boolean(validationError)}
          aria-required={required}
          capture={capture ? 'environment' : undefined}
          disabled={isUploading}
          type="file"
          onChange={handleChange}
        />
      </label>
      {isUploading ? <p className="upload-progress" role="status">{t('media.uploading')}</p> : null}
      {uploads.length ? (
        <ul className="media-preview-list">
          {uploads.map((media) => (
            <li key={media.id}>
              {media.media_type !== 'signature' ? (
                <img src={mediaDownloadUrl(media)} alt="" />
              ) : null}
              <span>{t('media.uploaded', { name: media.original_filename })}</span>
              {!submitted ? (
                <button type="button" className="secondary-button" onClick={() => void removeUpload(media)}>
                  {t('media.remove')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {validationError ? <small id={validationErrorId} className="field-error">{validationError}</small> : null}
      {error ? (
        <ErrorState
          message={error}
          onRetry={lastFailedFile ? () => void upload(lastFailedFile) : undefined}
        />
      ) : null}
    </div>
  );
}

type SignatureInputProps = Omit<MediaUploadFieldProps, 'mediaType' | 'label' | 'accept' | 'capture'> & {
  label: string;
  /** Notifies the parent whether a signature has been drawn (for validation). */
  onDrawnChange?: (hasDrawing: boolean) => void;
};

/** Imperative handle: the parent calls `commit()` on submit to upload the drawn signature. */
export type SignatureInputHandle = {
  commit: () => Promise<MediaFile | null>;
  hasDrawing: () => boolean;
};

export const SignatureInput = forwardRef<SignatureInputHandle, SignatureInputProps>(function SignatureInput(
  props,
  ref,
) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawing, setHasDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validationErrorId = useId();
  // Cache the uploaded signature so retrying a failed submit does not create
  // duplicate signature files; reset whenever the drawing changes or is cleared.
  const committedRef = useRef<MediaFile | null>(null);
  const changedSinceCommitRef = useRef(false);
  const signatureSubmittedRef = useRef(Boolean(props.submitted));

  useEffect(() => {
    signatureSubmittedRef.current = Boolean(props.submitted);
  }, [props.submitted]);

  useEffect(() => () => {
    if (
      !props.preserveOnUnmount
      && !signatureSubmittedRef.current
      && committedRef.current
      && !attachedMediaIds.has(committedRef.current.id)
    ) {
      void discardMedia(committedRef.current.id).catch(() => undefined);
    }
  }, [props.preserveOnUnmount]);

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

  function markDrawn() {
    changedSinceCommitRef.current = true;
    if (!hasDrawing) {
      setHasDrawing(true);
      props.onDrawnChange?.(true);
    }
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
    markDrawn();
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
    setHasDrawing(false);
    if (committedRef.current) {
      void discardMedia(committedRef.current.id).catch(() => undefined);
      props.onRemoved?.(committedRef.current);
      committedRef.current = null;
    }
    changedSinceCommitRef.current = false;
    setError(null);
    props.onDrawnChange?.(false);
  }

  useImperativeHandle(
    ref,
    () => ({
      hasDrawing: () => hasDrawing,
      async commit() {
        const canvas = canvasRef.current;
        if (!canvas || !hasDrawing) {
          return null;
        }
        if (committedRef.current && !changedSinceCommitRef.current) {
          return committedRef.current;
        }
        const previous = committedRef.current;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) {
          return null;
        }
        const file = new File([blob], 'signature.png', { type: 'image/png' });
        const media = await uploadMedia(file, { media_type: 'signature' });
        if (previous && !attachedMediaIds.has(previous.id)) {
          void discardMedia(previous.id).catch(() => undefined);
          props.onRemoved?.(previous);
        }
        committedRef.current = media;
        changedSinceCommitRef.current = false;
        return media;
      },
    }),
    [hasDrawing, props.vehicleId, props.loanId, props.relatedType, props.relatedId],
  );

  return (
    <div className="signature-field">
      <span className="field-label">{props.label}</span>
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        width="640"
        height="220"
        aria-label={props.label}
        aria-describedby={props.validationError ? validationErrorId : undefined}
        aria-invalid={Boolean(props.validationError)}
        aria-required={props.required}
        tabIndex={0}
        onPointerDown={beginDrawing}
        onPointerMove={draw}
        onPointerUp={endDrawing}
        onPointerCancel={endDrawing}
      />
      <div className="action-row">
        <button className="secondary-button" type="button" onClick={clearSignature}>
          {t('media.clearSignature')}
        </button>
      </div>
      <p className="hint-text">{t('media.signatureAutoSave')}</p>
      <MediaUploadField
        {...props}
        mediaType="signature"
        accept="image/*"
        label={t('media.signatureFallback')}
        validationError={props.validationError}
        validationErrorId={validationErrorId}
      />
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
});
