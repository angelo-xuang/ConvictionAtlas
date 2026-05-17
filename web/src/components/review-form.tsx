'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { postApi } from '../lib/api';
import type { Review } from '../lib/types';

export function ReviewForm({ managerSlug }: { managerSlug: string }) {
  const router = useRouter();
  const [authorName, setAuthorName] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      await postApi<Review>(`/managers/${managerSlug}/reviews`, {
        authorName,
        rating,
        comment,
      });
      setTone('success');
      setMessage('评价已提交。');
      setAuthorName('');
      setRating(5);
      setComment('');
      router.refresh();
    } catch (error) {
      setTone('error');
      setMessage(error instanceof Error ? error.message : '提交失败，请重试。');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <input
          className="input"
          placeholder="你的名字"
          value={authorName}
          onChange={(event) => setAuthorName(event.target.value)}
        />
        <select
          className="input"
          value={rating}
          onChange={(event) => setRating(Number(event.target.value))}
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value} 星
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="textarea"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="你对这个经理的最新持仓有什么看法？"
        rows={5}
        required
      />
      <button type="submit" className="button-link primary" disabled={isSubmitting}>
        {isSubmitting ? '提交中...' : '提交评价'}
      </button>
      {message ? <div className={`feedback ${tone}`}>{message}</div> : null}
    </form>
  );
}
