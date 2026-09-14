import { voice } from '@ledrums/core';
import type { ServerMessage } from '@ledrums/protocol';
import { handleVoiceInput } from './handlers/voice-input';
import { acceptsMidiChannel } from './midi-channel';
import type { TrackInputSink } from './track-input-registry';
import type { VoiceEngineHost } from './voice-engine-host';

/** Production admission/routing seam, shared with rendered-output tests. Registry admission
 * precedes BOTH raw MIDI and its scoped OSC aliases; cleanup can release an accepted note even
 * after the operator changes channel. No device traffic enters the authoring/role reducer. */
export function createTrackInputSink(
  host: VoiceEngineHost,
  broadcastJson: (message: ServerMessage) => void,
  active: () => boolean = () => true,
): TrackInputSink {
  return {
    acceptsMidiChannel: (channel) => acceptsMidiChannel(channel, host.getInputMap().midiChannel),
    midi: (input) => { if (active()) handleVoiceInput({ t: 'midi', ...input }, { voiceHost: host, broadcastJson }); },
    cc: (input) => { if (active()) handleVoiceInput({ t: 'cc', ...input }, { voiceHost: host, broadcastJson }); },
    osc: (address, value, edge) => {
      if (!active()) return;
      // Registry constructs this canonical address from the protocol-validated saved ID.
      const trackInputId = address.split('/')[2];
      if (edge === 'press') {
        handleVoiceInput({ t: 'osc', address, value }, {
          voiceHost: host,
          broadcastJson: (message) => broadcastJson(message.t === 'input' ? { ...message, trackInputId } : message),
        });
      } else {
        host.applyInput(edge === 'release' ? { kind: 'oscRelease', address } : { kind: 'oscValue', address, value });
        broadcastJson({ t: 'input', kind: 'osc', label: address, value, modulationOnly: true, trackInputId });
      }
    },
    audio: (id: string, frame: voice.AudioFeatureFrame) => {
      if (active() && host.getInputMap().trackAudioInput === id) host.applyInput({ kind: 'audioFeatures', ...frame });
    },
  };
}
