import React from 'react';

type Props = {
  onOpenRoom: () => void;
  onAttemptPublish: () => void;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  canAttemptPublish?: boolean;
};

export const MobileLiveJoin = ({
  onOpenRoom,
  onAttemptPublish,
  onToggleAudio,
  onToggleVideo,
  onToggleScreen,
  canAttemptPublish = true,
}: Props) => (
  <div data-testid="mobile-live-join-form" className="rounded-[18px] border p-3 bg-white shadow-sm">
    <p className="mb-2 text-sm text-gray-700">Mobile live room detected. For best results open the room in a full tab or use the native app.</p>
    <div className="flex gap-2 mb-2">
      <button data-testid="mobile-live-open-room" type="button" onClick={onOpenRoom} className="flex-1 rounded px-2 py-1 text-sm bg-blue-600 text-white">Open Room</button>
      <button data-testid="mobile-live-attempt-publish" type="button" onClick={onAttemptPublish} disabled={!canAttemptPublish} className="flex-1 rounded px-2 py-1 text-sm bg-green-600 text-white">Attempt Publish</button>
    </div>
    <div className="flex gap-2">
      <button data-testid="mobile-live-toggle-audio" type="button" onClick={onToggleAudio} className="flex-1 rounded px-2 py-1 text-sm bg-gray-100">Mic</button>
      <button data-testid="mobile-live-toggle-video" type="button" onClick={onToggleVideo} className="flex-1 rounded px-2 py-1 text-sm bg-gray-100">Camera</button>
      <button data-testid="mobile-live-toggle-screen" type="button" onClick={onToggleScreen} className="flex-1 rounded px-2 py-1 text-sm bg-gray-100">Share</button>
    </div>
  </div>
);

export default MobileLiveJoin;
