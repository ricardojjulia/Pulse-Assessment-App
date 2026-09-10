# User Tag

<!-- Jira: PRODUCT-13434 -->

**Gen3 replacement**: User tag (API/SDK)

**Phase 2 required**: yes

## What changes

Send the user tag via API or SDK. In addition, for web frontends you can extract your user tag through a CSS Selector or JavaScript variable.

## Customer actions

- Check if user tagging is done via extraction or via SDK/API
- If using SDK/API: calls to `dtrum.identifyUser` are forwarded to 3rd gen, and there is a new 3rd gen API
- If using extraction: configure CSS selector or JS variable extraction
