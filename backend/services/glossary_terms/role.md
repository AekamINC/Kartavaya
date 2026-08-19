# role

## Also called
roles, permission, permissions, access, admin, administrator, user role,
who can see, why can't they see,
रोल, भूमिका, अनुमति, परमिशन, एक्सेस, एडमिन

## What it means here
What a person may do is decided per organisation. One account can be an
administrator of one organisation and a client of another, so access is read
from that person's membership of the organisation in question — never from the
single role word stored on the account itself.
That one word is left over from an older design and is frequently out of step
with the truth: there are real organisation administrators whose account still
says "client". Those rows are correct as they stand and are not a data problem
waiting to be tidied up.

## A wrong answer looks like
"This user's role is client, so they cannot see the project." Their role in THIS
organisation decides that, and it may well be administrator. Answering from the
account-level word tells people they lack access they actually hold, and invites
somebody to go and "correct" rows that were never wrong.
