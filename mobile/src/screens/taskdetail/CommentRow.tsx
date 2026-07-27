import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { format, isToday } from 'date-fns';
import type { Comment } from '../../api/types';
import { Avatar } from './Avatar';
import { s } from './styles';

interface Props {
  comment:     Comment;
  isMine:      boolean;
  t:           any;
  onLongPress: () => void;
}

export function CommentRow({ comment, isMine, t, onLongPress }: Props) {
  const when = useMemo(() => {
    const d = new Date(comment.created_at);
    return isToday(d) ? format(d, 'HH:mm') : format(d, 'd MMM');
  }, [comment.created_at]);

  return (
    /* The comment actions were reachable ONLY by long press, which a screen
       reader cannot perform — 23 §"a feature reachable only by [gesture] does
       not exist". `accessibilityActions` exposes the same handler through the
       rotor, and the label reads the comment as one item instead of three. */
    <TouchableOpacity
      onLongPress={onLongPress}
      style={[s.commentRow, isMine && s.commentRowMine]}
      activeOpacity={0.85}
      accessible
      accessibilityLabel={`${isMine ? 'You' : comment.user_name}, ${comment.body}, ${when}`}
      accessibilityHint="Long press for comment actions"
      accessibilityActions={[{ name: 'longpress', label: 'Comment actions' }]}
      onAccessibilityAction={e => {
        if (e.nativeEvent.actionName === 'longpress') onLongPress();
      }}
    >
      {!isMine && <Avatar uid={comment.user_id} name={comment.user_name} size={30} />}
      <View style={[s.commentBubble, {
        backgroundColor: isMine ? t.primaryContainer : t.surfaceLow,
        borderColor: isMine ? t.primary + '55' : t.outline,
        alignSelf: isMine ? 'flex-end' : 'flex-start',
      }]}>
        {!isMine && (
          <Text style={[s.commentAuthor, { color: t.primary }]}>{comment.user_name}</Text>
        )}
        <Text style={[s.commentBody, { color: t.ink }]}>{comment.body}</Text>
        <Text style={[s.commentTime, { color: t.ink4 }]}>{when}</Text>
      </View>
      {isMine && <Avatar uid={comment.user_id} name={comment.user_name} size={30} />}
    </TouchableOpacity>
  );
}
