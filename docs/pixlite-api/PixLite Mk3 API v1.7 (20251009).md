# PixLite Mk3 API

Protocol Version: v1.7
Document Version: V20251009

# 1 Contents

[1 Contents](#1-contents)

[2 Introduction](#2-introduction)

[2.1 WebSocket](#21-websocket)

[2.2 HTTP](#22-http)

[3 Fundamentals](#3-fundamentals)

[3.1 API Versioning](#31-api-versioning)

[3.1.1 Naming](#311-naming)

[3.1.2 Backward Compatibility](#312-backward-compatibility)

[3.1.3 Supported Versions](#313-supported-versions)

[3.2 Configuration and Coherency](#32-configuration-and-coherency)

[4 HTTP(S)](#4-https)

[4.1 Connection](#41-connection)

[4.2 Content Types](#42-content-types)

[4.3 Unsupported Messages](#43-unsupported-messages)

[4.4 Status Codes](#44-status-codes)

[5 WebSocket](#5-websocket)

[5.1 Supported WebSocket Formats](#51-supported-websocket-formats)

[5.2 Typical WebSocket Client Session](#52-typical-websocket-client-session)

[5.3 Connection](#53-connection)

[5.4 WebSocket Close Status Codes](#54-websocket-close-status-codes)

[6 Message Syntax](#6-message-syntax)

[6.1 Message Types](#61-message-types)

[6.2 Request Message Format](#62-request-message-format)

[6.3 Response Message Format](#63-response-message-format)

[6.4 Notification Message Format](#64-notification-message-format)

[6.5 JSON and Notation](#65-json-and-notation)

[6.6 Specifying Object Paths](#66-specifying-object-paths)

[6.7 Error Codes](#67-error-codes)

[7 Messages](#7-messages)

[7.1 Configuration](#71-configuration)

[7.1.1 Config Object](#711-config-object)

[7.1.1.1 Trigger Event Object](#7111-trigger-event-object)

[7.1.1.2 Trigger Actions Object](#7112-trigger-actions-object)

[7.1.1.3 Example Config Object](#7113-example-config-object)

[7.1.2 Config Read](#712-config-read)

[7.1.3 Config Change](#713-config-change)

[7.1.4 Config-Change Notification](#714-config-change-notification)

[7.2 Constants](#72-constants)

[7.2.1 Constant Object](#721-constant-object)

[7.2.2 Constant Read](#722-constant-read)

[7.3 Disconnect Notification](#73-disconnect-notification)

[7.4 Firmware Upload](#74-firmware-upload)

[7.4.1 Initiate Firmware Upload](#741-initiate-firmware-upload)

[7.4.2 Send Firmware Block](#742-send-firmware-block)

[7.5 Identify](#75-identify)

[7.6 Import/Export](#76-importexport)

[7.6.1 Export](#761-export)

[7.6.2 Import](#762-import)

[7.7 Modes](#77-modes)

[7.7.1 Live Mode](#771-live-mode)

[7.7.2 Test Data Mode](#772-test-data-mode)

[7.7.3 Playback Mode](#773-playback-mode)

[7.7.4 Record Mode](#774-record-mode)

[7.8 Controls](#78-controls)

[7.8.1 Mode Control](#781-mode-control)

[7.8.2 Playback Control](#782-playback-control)

[7.9 File Management](#79-file-management)

[7.9.1 Format MicroSD Card](#791-format-microsd-card)

[7.9.2 File Attribute](#792-file-attribute)

[7.9.3 File Rename](#793-file-rename)

[7.9.4 File Delete](#794-file-delete)

[7.9.5 File List](#795-file-list)

[7.9.6 Recorded Scene File Information](#796-recorded-scene-file-information)

[7.9.7 File Upload](#797-file-upload)

[7.9.7.1 Initiate File Upload](#7971-initiate-file-upload)

[7.9.7.2 Send File Block](#7972-send-file-block)

[7.9.8 File Download](#798-file-download)

[7.9.9 File-Change Notification](#799-file-change-notification)

[7.10 Password Change](#710-password-change)

[7.11 Programmed Intensity](#711-programmed-intensity)

[7.12 Restart](#712-restart)

[7.13 Statistics](#713-statistics)

[7.13.1 Statistic Object](#7131-statistic-object)

[7.13.2 Statistic Read](#7132-statistic-read)

[7.13.3 Statistic Subscription](#7133-statistic-subscription)

[7.13.4 Statistic Notification](#7134-statistic-notification)

[7.13.5 Statistic Reset](#7135-statistic-reset)

[7.14 Status](#714-status)

[7.14.1 Status Object](#7141-status-object)

[7.14.1.1 State Object](#71411-state-object)

[7.14.1.2 Store Object](#71412-store-object)

[7.14.1.3 Output Intensity Object](#71413-output-intensity-object)

[7.14.2 Status Read](#7142-status-read)

[7.14.3 Status-Change Notification](#7143-status-change-notification)

# 2 Introduction

This document describes an Application Programming Interface (API) for the PixLite Mk3 series of controllers. Its purpose is to enable software developers to implement a client that can manage a PixLite Mk3 controller.

The API supports two application layer protocols, namely: HTTP or WebSocket. Each has their advantages and disadvantages. This document only aims to provide a basic overview of why a client may prefer to use one over the other in the context of PixLite control systems.

## 2.1 WebSocket

A WebSocket connection facilitates simultaneous two-way communication between a client and the controller, offering several key advantages:

* Notification messages to automatically synchronise the client to changes of the controller's configuration or status.
* For requests that may take lengthy time, the client is notified when the operation is complete.
* Subscription capability enabling the controller to periodically send information to the client.

Advatek Lighting recommends clients use a WebSocket connection.

## 2.2 HTTP

An HTTP based connection is ubiquitous, with many third-party libraries supporting it. An HTTP based connection is transactional and remains open only for the duration of the requests initiated by the client. Messages from the host to the client occur only at the request of the client. Some circumstances in which a client might use an HTTP based connection are:

* Lack of WebSocket library on the platform they are developing on.
* Sending only a small number of messages (and possibly rarely).
* The state of the controller is irrelevant to the client (no need to be synchronized with the controller's configuration and status).
* Client does not wish to maintain a persistent TCP connection to the controller.

HTTP clients may need to poll for updates to the controller's configuration and status, because these may be changed by other clients or triggers at any time.

# 3 Fundamentals

## 3.1 API Versioning

### 3.1.1 Naming

API version names have the form (using ABNF):

api-version = api-version-major "." api-version-minor

The elements of the API version are listed in Table 1.

| Element | Description |
| --- | --- |
| api-version-major | A string. A controller may support more than one api-version-major. |
| api-version-minor | An integer ranging from 0, which increases with each change of the api-version-major. |
| api-version | This document describes the API of `v1.7` (without the quotes). |

Table 1 Elements of the API version

### 3.1.2 Backward Compatibility

The controller supports clients using api-version-minor less than or equal its own.

All the messages sent by the controller are of its api-version-minor.

API changes will be designed to introduce new features while striving to maintain the form of the earlier versions. However, as changes occur, new parameters might be added, and existing parameters might be modified to allow values that were not possible in earlier versions.

For earlier API version clients to manage later version controllers, the client must:

1. Connect as its API version.
2. Ignore parameters in messages it receives from the controller that it does not understand.
3. Recognize, if it does not understand a parameter's value, it is of a later API version and its value is not invalid.

For later API version clients to manage earlier version controllers, the client must:

1. Connect as the controller's API version.
2. Constrain the parameters and their values in messages it sends to the controller to the controller's API version.

### 3.1.3 Supported Versions

To ensure compatibility with the controller, the client must:

1. Confirm the API versions that the controller supports,
2. Select the highest api-version-minor of an api-version-major that is mutually supported by both parties.

The controller's version request, described in [7.15 Version](#715-version), is engineered to be agnostic to API version changes, ensuring future-proof communication between the client and the controller.

## 3.2 Configuration and Coherency

When the controller boots, it reads its saved configuration from non-volatile memory to RAM, and this is called its running configuration. When a client reads the controller's configuration, it reads its running configuration.

When a client changes the controller's configuration, it may "apply" the change to its running configuration, without saving it to non-volatile memory. This allows an operator to experiment and see the effect of the changes, and subsequently save or undo the changes. As a client changes the running configuration, the controller keeps all clients connected using the WebSocket protocol coherent, by notifying them of any changes.

The scenarios listed in Table 2 explain the various ways the configuration can be manipulated.

| Scenario | Event Sequence |
| --- | --- |
| Make configuration change and immediately save it | 1. A client requests the running configuration. The controller returns the configuration and whether it is permanently saved or not. 2. A client requests configuration changes to the controller and requests that the changes are immediately saved. If the status of the controller's running configuration was unsaved, it now becomes saved. 3. The controller notifies all the other WebSocket clients that a configuration change was made, and that the configuration is saved. |
| Make configuration change, then later save it | 1. A client requests the running configuration. The controller returns the configuration and whether it is permanently saved or not. 2. A client requests configuration changes to the controller and requests that the changes only be applied (not saved). If the status of the controller's running configuration was saved, it now becomes unsaved. 3. The controller notifies all the other WebSocket clients that a configuration change was made, and that the configuration is not saved. 4. Any client may request that the controller now saves its running configuration. The status of the running configuration becomes saved. 5. The controller notifies all the other WebSocket clients that the configuration is now saved. |
| Make configuration change, then later revert to previously saved configuration | 1. A client requests the running configuration. The controller returns the configuration and whether it is permanently saved or not. 2. A client requests configuration changes to the controller and requests that the changes only be applied (not saved). If the status of the controller's running configuration was saved, it now becomes unsaved. 3. The controller notifies all the other WebSocket clients that a configuration change was made, and that the configuration is not saved. 4. Any client may request that the controller now reverts its running configuration to the previously saved configuration. The status of the running configuration becomes saved. 5. The controller notifies all the other WebSocket clients of the new running configuration and that the configuration is saved. |

Table 2 Methods of configuration change

# 4 HTTP(S)

## 4.1 Connection

The controller supports HTTP/1.1 only.

In this document, HTTP applies both HTTP and HTTPS.

The controller listens on TCP ports 80 for HTTP and 4443 for HTTPS. A root certificate for secure connections may be obtained from Advatek Lighting.

RFC 7230 defines an HTTP request line as follows (using ABNF):

request-line = method SP request-target SP HTTP-version CRLF

Where for the controller:

method = "GET" / "POST"

request-target = open-target

/ "/" api-version [restricted-target ] [ "?" ( user-param / auth-param )

*( "&" ( user-param / auth-param ) ) ]

open-target = endpoint

restricted-target = endpoint

endpoint = "/" *ALPHA

HTTP-version = "HTTP/1.1"

api-version = "/" api-version-major "." api-version-minor

api-version-major = "v" 1*ALPHA

api-version-minor = 1*DIGIT

user-param = "user=" username

auth-param = "auth=" password-hash

The elements of an HTTP request to the controller are listed in Table 3.

<table>
<tr><th>Element</th><th>Description</th><th></th><th></th></tr>
<tr><td>open-target</td><td>The endpoint of a request that requires neither API-versioning nor authenticating.  There is a single case:</td><td></td><td><table border="1"><tr><td>`/ver`</td><td>Get version information. Refer [7.15 Version](#715-version).</td></tr></table></td></tr>
<tr><td>api-version</td><td>The API version.  An example is `v1.7` (without the quotes), for the current API version. Refer [3.1 API Versioning](#31-api-versioning).</td><td></td><td>These elements are for a request that requires both API-versioning and authenticating.</td></tr>
<tr><td>restricted-target</td><td>The endpoint of a request that requires both API-versioning and authenticating.  Its cases include:</td><td></td><td><table border="1"><tr><td>/</td><td>Upgrade to WebSocket.</td></tr><tr><td>`/microsd/filename`</td><td>Download a file from the microSD card. Refer [7.9.8 File Download](#798-file-download).</td></tr><tr><td>/</td><td>All other request messages. Refer [6 Message Syntax](#6-message-syntax).</td></tr></table></td></tr>
<tr><td>user-param</td><td>The query component specifying the username to authenticate.  There are two usernames:</td><td></td><td><table border="1"><tr><td>admin</td><td>The administrator user. This user may send any type of request.</td></tr><tr><td>oper</td><td>The operator user. This user may send requests that control the operations, but is not authorized to send requests that would change the controller's configuration.</td></tr><tr><td>The query components may be specified in any order.  The user-param is optional, and if not specified, the username defaults to `admin`.  If the user's password is empty, the auth-param becomes optional. A client supporting automatic password-less authentication may check the "authReqd" or `operUser.authReqd` members of the GET `/ver` response to ascertain whether the configured password for the admin or oper user is empty or not.</td><td></td></tr></table></td></tr>
<tr><td>auth-param</td><td>The query component specifying the password-hash to authenticate. The hash is generated by taking the SHA-256 hash of the user's password text and then Base64URL-encoduing the result (i.e. Base64URL(SHA256(password text))).  An example is "auth=47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU" (without the quotes), for an empty password.</td><td></td><td></td></tr>
</table>

Table 3 Elements of an HTTP request-line sent to the controller

***Info:*** *The password-hash in the authentication query is* *`Base64URL`* *encoded because* *`Base64`* *may be invalid in a URL. This is specifically described in RFC 4648 [5 WebSocket](#5-websocket), which says the Base64 '+' character should be replaced by a hyphen '-', and the Base64 '/' character should be replaced by an underscore '_'. The Base64URL encode would always have one or possibly two trailing '=' pad characters, and its last pad character may be omitted. The controller does not support percent-encoding of any characters of that Base64URL.*

***Note:*** *An authentication of a disabled user would fail. Refer the `config:dev.user` member of section [7.1.1 Config Object](#711-config-object). The administrator user cannot be disabled.*

## 4.2 Content Types

The content type of HTTP message bodies is indicated by a mandatory Content-Type header field. The types used by the API messages are listed in Table 4. Generally, messages are JSON text unless indicated otherwise.

| Content type | Content-Type header value |
| --- | --- |
| JSON text | application/json |
| Binary data | application/octet-stream |

Table 4 HTTP content-type headers

## 4.3 Unsupported Messages

Some API messages are not supported in HTTP (due to limitations of HTTP). For instance, `notifications` (unsolicited messages from the controller to clients) are supported only with WebSockets.

## 4.4 Status Codes

The status codes used in HTTP responses are listed in Table 5.

| HTTP response status code | | Description |
| --- | --- | --- |
| 200 | OK | The request was successfully received and accepted. |
| 400 | Bad Request | The request is invalid. |
| 404 | Not Found | The page or file was not found. |
| 503 | Service Unavailable | The service is temporarily unavailable. |

Table 5 HTTP response status codes

***Note:*** *A 200 status of an HTTP POST response would indicate only that its HTTP was successful. Errors of the request body would be indicated by the inclusion of an error object in the response's JSON text body, as described in [6.7 Error Codes](#67-error-codes).*

Upon receiving an HTTP response, an HTTP based client should close its connection if it does not have another request ready to send.

# 5 WebSocket

## 5.1 Supported WebSocket Formats

The WebSockets are as described at [RFC 6455], with the following exceptions:

* Secure WebSocket connections, i.e. "wss://", must be directed to TCP port 4443. Refer [4.1 Connection](#41-connection).
* All API messages listed in this document are supported in WebSocket unless stated otherwise where the message is described.

These frame variants are not supported:

* Non-zero frame-RSV bits,
* Fragmented messages, i.e. continuation frames, from the client,
* Extension data,
* Data frames other than Text and Binary, and
* Control frames other than Close.

The frame opcodes used by the API messages are listed in Table 6. Generally, messages are Text unless indicated otherwise.

| Message type | Frame opcode |
| --- | --- |
| Text data | Text |
| Binary data | Binary |

Table 6 WebSocket frame opcodes

If the controller receives an unsupported WebSocket frame format, it will close the connection with a status code of PROTOCOL_ERROR (1002).

## 5.2 Typical WebSocket Client Session

A typical WebSocket client's session may sequence:

1. Choose whether to connect as administrator or as operator user.
2. Send an HTTP GET `/ver` request to get the controller's version information to ascertain its range of supported APIs and whether the user's configured password is empty or not.
3. If the password is non-empty, authentication is required, and so prompt the user to enter the password.
4. Send an HTTP upgrade request to change to WebSocket and, if required, to simultaneously authenticate using the password's hash.
5. Send and receive WebSocket messages to manage the controller (read configuration, change configuration, read or subscribe statistics, perform test functions, change mode, etc).
6. Close the WebSocket connection.

## 5.3 Connection

Using JavaScript for illustration, a WebSocket connection is created using the W3C WebSocket constructor of Figure 1 and its parameters are described in Table 7.

thisWebSocket = new WebSocket(url[, protocols]);

Figure 1 JavaScript WebSocket constructor

Upon invoking the WebSocket constructor, the client's browser sends an HTTP upgrade request to the controller.

| WebSocket constructor's parameters | Value (using ABNF) | Description |
| --- | --- | --- |
| url | ( "ws" / "wss" ) "://" controller-ip-address [ ":4443" ] "/" api-version [ "?" ( user-param / auth-param ) *( "&" ( user-param / auth-param ) ) ]  An example is "ws://192.168.0.100/v1.7?user=admin&auth=47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU". | The url parameter specifies the URL to which to connect.  The controller-ip-address is the controller's Ipv4 address or its name if the address has been configured in a DNS. Refer Table 3 for the definitions of the other elements.  The "wss" and ":4443" would be necessary to connect as a secure WebSocket. |
| protocols | Not applicable. | The optional protocols parameter specifies one of more subprotocols the client wishes to speak, that the WebSocket constructor passes in a Sec-WebSocket-Protocol header.  The controller does not support the Sec-WebSocket-Protocol header. Do not use the protocols parameter. |

Table 7 JavaScript WebSocket constructor's parameters

The HTTP upgrade request may return one of the following status codes listed in Table 8.

| HTTP response status code | | Description |
| --- | --- | --- |
| 101 | Switching Protocols | The controller accepted the upgrade to WebSocket. This does not imply the connection is complete, as authentication occurs immediately after upgrade (explained further below). |
| 400 | Bad Request | The controller rejected the upgrade to WebSocket. Its likely reason is a malformed URL in the HTTP upgrade request. |

Table 8 HTTP upgrade response status codes

The WebSocket constructor is unable to distinguish between different errors with just the HTTP response status code. For example, it would be impossible to tell the difference between a bad request and an incorrect password. However, if the authentication failed because the password-hash is incorrect, the client software should ideally be able to inform its operator that the password they entered is incorrect. To enable more detailed feedback for the client, the controller will always accept a properly formatted WebSocket upgrade request, regardless of the password used. If the password is incorrect, the controller will then immediately close the connection with a suitable WebSocket close status code. WebSocket close status codes provide more flexibility than the HTTP upgrade response status codes.

Continuing the above JavaScript example through this connection / authentication process:

1. Client performs the HTTP upgrade to WebSocket request.
2. If the API version of the URI is good, the controller accepts the upgrade by responding with status code 101 (Switching Protocols) and the thisWebSocket object's readyState transitions to OPEN. The OPEN state informs the client its upgrade to WebSocket was successful.
3. If the URL is malformed or if a Sec-WebSocket-Protocol header is specified,the controller instead rejects the upgrade by responding with status code 400 (Bad Request), and the thisWebSocket object's readyState transitions to CLOSED. A CLOSED state informs the client the form of its upgrade was incorrect.
4. Following a successful upgrade, if the authentication query is valid (refer Table 3), the controller deems the authentication successful and the connection remains open (the client is not separately informed of a successful authentication).
5. If the authentication was invalid (incorrect password), the controller immediately closes the WebSocket connection with a status code of CLOSE_BAD_AUTH_CODE (4001). A close with this status code informs the client the password was incorrect.

***Info:*** *More than one client may connect a controller at the same time. Because controller's resources are limited, its number of concurrent WebSocket connections is limited. So, clients should hold their WebSocket connection open only for as long as necessary.*

If an authentication is successful and there were already a maximum number of WebSocket connections, the controller will disconnect the client it least recently received a message from. When the controller disconnects that client, it first sends a disconnect notification message (with a code indicating too many clients), then it closes its connection with a status code of CLOSE_NORMAL (1000).

There are other circumstances when the controller must disconnect a client, as described in [7.3 Disconnect Notification](#73-disconnect-notification).

## 5.4 WebSocket Close Status Codes

WebSockets include a close status code (16-bit integer) in close frames, to indicate the reason for closing the connection. The close-codes pertinent to this API are listed in Table 9.

| Close Status Code | Enumeration | Description |
| --- | --- | --- |
| 1000 | CLOSE_NORMAL | The connection was closed with a disconnect notification for any normal reason, as described in this document. |
| 1002 | PROTOCOL_ERROR | The connection was closed because of a noncompliant framing per RFC 6455. For example, it was not masked. |
| 1006 | CLOSE_ABNORMAL | The connection was closed abnormally (that is, without a close frame being sent). This code is synthesized by the client-side browser, e.g., if the LAN cable is disconnected. After the network is restored, the client must reconnect to continue. |
| 1008 | CLOSE_POLICY_ERROR | The connection was closed because it used unsupported framing per [5.1 Supported WebSocket Formats](#51-supported-websocket-formats). |
| 4001 | CLOSE_BAD_AUTH_CODE | The password hash used for the HTTP upgrade to WebSocket's authentication is invalid, or its user is disabled. |

Table 9 WebSocket close status codes

# 6 Message Syntax

## 6.1 Message Types

The types of messages are listed in Table 10.

| Type | Description |
| --- | --- |
| Request | Requests are sent from a client to the controller. |
| Response | Responses are sent back to a client, following a request. |
| Notification | Notifications are sent unsolicited from the controller to one or more clients. Notifications only apply connections by WebSockets. The client shall not respond to notifications. |

Table 10 Message types

An example of the request, response, notification paradigm is:

1. A client sends a request to change the configuration of the controller.
2. The controller sends a response indicating that the change was successful. The response includes the current configuration.
3. The controller sends a notification containing the current configuration to any WebSocket clients (excluding the client who sent the initial request, if they were a WebSocket client).

***Info:*** *The controller processes requests in receive-order, including sending notifications if they are warranted. So, a client may receive a notification between it sending a request and receiving its response, because of an earlier request by another client.*

***Warning:*** *A client should not send multiple messages at once to the controller. It should wait for a response to the earlier message before sending the next request. The controller may also drop duplicate messages during periods of high load, provided they do not affect any changes.*

## 6.2 Request Message Format

The request message's object is listed in Table 11.

| Name | Description |
| --- | --- |
| req | The name of the request message being sent. This field is mandatory. |
| id | An optional unique message identifier established by the client. Valid values are 32-bit unsigned integers, excluding 0.  The response message from controller will use the same id value as the request. This allows a client to correlate the response with this request.  Clients using the HTTP protocol are more likely not to use this field, as the response is already tied to the request as part of the HTTP protocol.  WebSocket clients should consider incrementing the value of this field for each new request, so that the response from the controller can be matched to the request. |
| params | An object that contains any required parameters. This will vary depending on the message type. This may be omitted if none of the message parameters are mandatory. |

Table 11 Request message object

An example request message object is listed in Figure 2.

| {    `req`: `configChange`,    `id`: 1,    `params`: {      `action`: "save",      `config`: {        //…      }    }  } |
| --- |

Figure 2 Example request message

***Warning:*** *The JSON members of all messages are strictly ordered. The first member of a request type message must be `req`.*

## 6.3 Response Message Format

The response message object is listed in Table 12.

| Name | | Description | |
| --- | --- | --- | --- |
| resp | | The name of the response message being sent. | |
| id | | The same value as the id field value used by the client in the original request. Allows a client to correlate this response with the original request. | |
| result | | An object that contains the result if its request was valid for the message type. This will be present if the request was OK and will not be present if the request had an error. | |
| err | code | An integer code representing the type of error. | An object that contains error information. This will be present if the request had an error and will not be present if the request was OK. |
| msg | A string description of the cause of the error. |

Table 12 Response message object

Example response message objects are listed in Figure 3 and Figure 4.

| {    `resp`: `configChange`,    `id`: 1,    `result`: {      `saved`: true,      `config`: {        //…      }    }  } |
| --- |

Figure 3 Example response message

| {    `resp`: `configChange`,    `id`: 1,    "err": {      `code`: 3,      `msg`: "The pix.freq field may not be > 3000."    }  } |
| --- |

Figure 4 Example response message with error

## 6.4 Notification Message Format

The notification message object is listed in Table 13.

| Name | Description |
| --- | --- |
| notify | The name of the notification message being sent. |
| params | An object that contains any parameters. This will vary depending on the message type. This may be omitted if the notification message type has no parameters required in the notification. |

Table 13 Notification message object

An example notification message object is listed in Figure 5.

| {    `notify`: `configChange`,    `params`: {      `action`: "save",      `config`: {        //…      }    }  } |
| --- |

Figure 5 Example notification message

***Info:*** *Notifications are sent to WebSocket clients only. Generally, if any client requests a change, it receives a response but not a notification. The notification is sent to the other WebSocket clients, so they are aware of the change.*

## 6.5 JSON and Notation

The messages of the WebSocket frames and HTTP bodies described in this document are encoded in JSON unless otherwise stated.

The JSON is as described in [RFC 8259], with the exceptions:

* Name/value pairs are strictly ordered.
* Text is restricted to UTF-8's first 128 code points, i.e. only ASCII characters, and without character escapes.
* Floating point numbers may range -16777216 to 16777216, and the exponential part is not supported.
* By definition, JSON arrays are ordered collections of zero or more values, and an assignment to an array member replaces the array value entirely. However, in assignments to certain array members of the controller configuration, such as those of the `config:pixPort` object, where the array elements are sequenced by pixel port number, only the elements explicitly specified in the assignment are affected. For instance, an assignment specifying one element would affect only the first pixel port's value and leave the other pixel ports unchanged. However, to change the Nth pixel port's value, it must specify at least the first N elements.

All the string values defined in this specification are **case sensitive**.

It is recommended the client avoid whitespace between members as it increases message sizes; potentially exceeding the capacity of the controller.

In this document, the following notations may be used in descriptions:

* A JavaScript-like dot notation, starting from the root of the object, is employed to reference a member.
* Preceding the dot notation with the object's name and ':' character, e.g. `object:member`, is utilized if the member belongs to a specific object.
* "//…" (without the quotation marks) in examples, to indicate where members have been removed for brevity.

## 6.6 Specifying Object Paths

A request message that reads or subscribes information of the controller may specify paths to individual members of an object using JavaScript-like dot notation. This allows a client to be more specific about a JSON object or member they are interested in.

As an example, the statistic object (explained later) contains running information about the controller. A client may want to read only parts of the object, in this case, the current temperature of the controller. The client sends a `statisticRead` request with one path, as listed in Figure 6. The path indicates that within the statistic object, the client is interested in the "current" member of the "temp" object, which itself is inside the "dev" object. Note the `path` member in the example.

| Request Body | {    `req`: `statisticRead`,    `id`: 2,    `params`: {      `path`: [        `dev.temp.current`      ]    }  } |
| --- | --- |
| Response Body | {    `resp`: `statisticRead`,    `id`: 2,    `result`: {      `statistic`: {        "dev": {          "temp": {            "current": 32.5          }        }      }    }  } |

Figure 6 Example `statisticRead` request and response messages

***Note:*** *The dot notation mechanism can specify an array member (the name of the array), but it cannot be used to specify individual elements of its array.*

Various examples are included throughout the document which illustrate the use of dot notation to specify a `path`.

A request message that changes configuration may make partial changes and optionally omit the configuration that is unchanged. As an example, the client may change only two parameters of configuration, as listed in Figure 7. The other parameters of the configuration would be unchanged.

| Request Body | {    `req`: `configChange`,    `id`: 1,    `params`: {      `action`: "apply",      `config`: {        "net": {          `ipMode`: true        },        "pix": {          "dataSrc": `Art-Net`        }      }    }  } |
| --- | --- |

Figure 7 Example `configChange` request message

***Warning:*** *The JSON members and objects are strictly ordered. Therefore, the above request is legal, but sending the "pix" object before the "net" object is not allowed.*

## 6.7 Error Codes

If a request is unsuccessful, its response will contain a JSON error object including an integer code and a descriptive string. The error codes are listed in Table 14.

| Result Code | Enumeration          | Description                                                                                                                                                                                                                                                                                                                                        |
| ----------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1           | REQUEST_ERROR        | The request is malformed.                                                                                                                                                                                                                                                                                                                          |
| 2           | VALUE_ERROR          | An object's value is invalid.                                                                                                                                                                                                                                                                                                                      |
| 3           | PATH_ERROR           | The path to an object or field is unrecognized or missing.                                                                                                                                                                                                                                                                                         |
| 4           | PASSWORD_ERROR       | The password-hash is invalid.  This only applies a `passChange` request of the administrator user's password.                                                                                                                                                                                                                                      |
| 5           | STATSUB_ERROR        | Reached the limit for number of statistic subscriptions.                                                                                                                                                                                                                                                                                           |
| 6           | STATUNSUB_ERROR      | A statistic object was unable to be unsubscribed.  If more than one object was listed in the statistic unsubscribe request, the controller may not have unsubscribed them all. To recover, the client should send another statistic unsubscribe request specifying an empty path ("") to unsubscribe from all statistics, or it should disconnect. |
| 7           | BUSY_ERROR           | Another client is using the feature.  This error may be returned to a `fwUploadStart` request if another client is already uploading firmware.                                                                                                                                                                                                     |
| 8           | BLOCK_ERROR          | The firmware update block request is invalid.  Either the offset is not the previous block's offset plus block-size OR the time between successive blocks was too great and the controller timed-out the upload.                                                                                                                                   |
| 9           | FW_ERROR             | The uploaded firmware is invalid.                                                                                                                                                                                                                                                                                                                  |
| 10          | NOTALLOWED_ERROR     | The request is inconsistent with the configuration or state of the controller, or the client's user is not authorized to make the request.                                                                                                                                                                                                         |
| 11          | NOTCOMPAT_ERROR      | The request is not compatible with the controller's functionality.                                                                                                                                                                                                                                                                                 |
| 12          | NOTSUPPORT_ERROR     | The request is not supported.                                                                                                                                                                                                                                                                                                                      |
| 13          | INTERRUPT_ERROR      | The operation was interrupted before it could complete.                                                                                                                                                                                                                                                                                            |
| 14          | CARDNOTFOUND_ERROR   | Card not found.                                                                                                                                                                                                                                                                                                                                    |
| 15          | FILENOTALLOWED_ERROR | The filename coding is not allowed.                                                                                                                                                                                                                                                                                                                |
| 16          | FILENOTFOUND_ERROR   | File not found (read).                                                                                                                                                                                                                                                                                                                             |
| 17          | FILEREAD_ERROR       | File read error.                                                                                                                                                                                                                                                                                                                                   |
| 18          | FILEWRITE_ERROR      | File write error                                                                                                                                                                                                                                                                                                                                   |
| 19          | UNAVAILABLE_ERROR    | A service is unavailable, e.g. because of insufficient memory.                                                                                                                                                                                                                                                                                     |
| 20          | CONFLICTED_ERROR     | The sACN input streams have duplicate priority and universes.                                                                                                                                                                                                                                                                                      |

Table 14 Result codes

***Note:*** *Future versions of this API may introduce new error codes. Therefore, a client must be able to handle error codes they do not understand.* *For this reason, any response message containing an error includes the `msg` member that briefly describes the error.*

# 7 Messages

In this document, the designator `Aux:N` will be used to indicate one of the Auxiliary ports. The value of ":N" ranges from 1 to constant:dev.auxPorts and if omitted means `Aux:1`

## 7.1 Configuration

### 7.1.1 Config Object

The controller's configuration is represented by an object named `config`, listed in Table 15.

<table>
<tr><th>Object Path</th><th>Name</th><th></th><th></th><th>Values</th><th></th><th>Description</th><th></th></tr>
<tr><td>net</td><td>ipMode</td><td></td><td></td><td>String.</td><td></td><td></td><td><table border="1"><tr><td>"Static"</td><td>The IP address is assigned statically.</td></tr><tr><td>"DHCP/AutoIP"</td><td>The IP address is dynamically allocated by a DHCP server, or if no DHCP server is detected, by AutoIP.</td></tr><tr><td>The IP assignment mode.</td><td></td></tr></table></td></tr>
<tr><td>staticIpAddr</td><td></td><td></td><td>String of decbyte "." Decbyte "." Decbyte "." Decbyte, where decbyte is an integer ranging 0 to 255.</td><td></td><td>The static Ipv4 address to be used if ipMode is "Static".  It is invalid to configure the static IP address as the factory-IP address.  The member is only used if `ipMode` is "Static".</td><td></td><td></td></tr>
<tr><td>staticNetmask</td><td></td><td></td><td>String of decbyte "." Decbyte "." Decbyte "." Decbyte, where decbyte is an integer ranging 0 to 255.</td><td></td><td>The static Ipv4 subnet mask.  The member is only used if `ipMode` is "Static".</td><td></td><td></td></tr>
<tr><td>staticGateway</td><td></td><td></td><td>String of decbyte "." Decbyte "." Decbyte "." Decbyte, where decbyte is an integer ranging 0 to 255.</td><td></td><td></td><td></td><td><table border="1"><tr><td>"0.0.0.0"</td><td>No gateway.</td></tr><tr><td>Any other value.</td><td>The gateway is enabled.</td></tr><tr><td>The static Ipv4 gateway address.  The member is only used if `ipMode` is "Static".  If `ipMode` is "Static" and there is no gateway, then only communication with hosts within the subnet is possible.</td><td></td></tr></table></td></tr>
<tr><td>dev</td><td>nickname</td><td></td><td></td><td>String of maximum length 63 characters.</td><td></td><td>The nickname of the controller.</td><td></td></tr>
<tr><td>indsEn</td><td></td><td></td><td>Boolean.</td><td></td><td>Whether the indicator LED's are enabled (visible).</td><td></td><td></td></tr>
<tr><td>user</td><td>Array of object.</td><td>typ</td><td>String.</td><td></td><td></td><td></td><td><table border="1"><tr><td>`oper`</td><td>The operator user.</td></tr><tr><td>The user.  *Note:* *the administrator user's parameters cannot be read or changed via the `config` object.*</td><td></td></tr></table></td></tr>
<tr><td>pass</td><td>44-character Base64-encoded string.</td><td></td><td>The SHA-256 hash of the password text.  This member is write-only. It may appear in a `configChange` request but would not appear in a `configRead` response.  To clear the password (make it empty), it is necessary to change it to the SHA-256 hash of an empty string.</td><td></td><td></td><td></td><td></td></tr>
<tr><td>en</td><td>Boolean.</td><td></td><td>Whether the user is enabled or disabled.</td><td></td><td></td><td></td><td></td></tr>
<tr><td>operIf</td><td>layout</td><td></td><td></td><td>String of maximum length 119 characters.</td><td></td><td>The layout of panes.</td><td>These members are reserved for the controller's SPA's SHOWTime Dashboard.</td></tr>
<tr><td>logo</td><td></td><td></td><td>String of maximum length 63 characters.</td><td></td><td>A logo image to be displayed. An empty string ("") means no logo.</td><td></td><td></td></tr>
<tr><td>pal</td><td></td><td></td><td>Array of up to 12 arrays of 3 (RGB) or 4 (RGBW) integers, ranging 0 to 65535.</td><td></td><td>Up to 12 color palettes.</td><td></td><td></td></tr>
<tr><td>colorRes</td><td></td><td></td><td>String of "8Bit" or "16Bit".</td><td></td><td>The resolution of the operIf.pal array values.</td><td></td><td></td></tr>
<tr><td>fadeMs</td><td></td><td></td><td>Integer ranging 0 to 4294967295.</td><td></td><td>The fade time in milliseconds applied to operations.</td><td></td><td></td></tr>
<tr><td>pix</td><td>dataSrc</td><td></td><td></td><td>String of "sACN", `Art-Net`, or `Aux:N`.</td><td></td><td>The source of the DMX data to be routed to the pixel outputs.  If the source is an Aux port, the respective port's mode must be configured "DMX512In" also.</td><td></td></tr>
<tr><td>pixType</td><td></td><td></td><td>Clients are first to select an object of the array at constant:pixTypes, listing the pixel types supported by the controller and their characteristics, then use its members to manage the configuring of these members.  Refer [7.2.1 Constant Object](#721-constant-object).</td><td>String. From the selected pixel-type's "pixType" value.</td><td>The name of the type of chip in the pixels.  This type applies the pixels of all the pixel outputs.</td><td></td><td></td></tr>
<tr><td>colorType</td><td></td><td></td><td>String. From the selected pixel-type's "colorTypes" list of values.</td><td>The color-type of the pixels.</td><td></td><td></td><td></td></tr>
<tr><td>freq</td><td></td><td></td><td>Integer number. Derived from the selected pixel-type's "freqMin", "freqMax" and "freqStep" values.</td><td>The pixel frequency.  Higher frequencies provide better refresh rate, but lower frequencies may operate more reliably over greater distances.  The frequency is in units of kHz.</td><td></td><td></td><td></td></tr>
<tr><td>expand</td><td></td><td></td><td>Boolean.</td><td>Expanded means the pixel port's clock line is used for data, doubling the controller's effective number of pixel port outputs.  It can only be true (enabled) if the selected pixel-type's "canExpand" is true; indicating the pixel protocol does not use a clock line, i.e. its data is self-clocked.  However it comes with the limitation that the maximum number of pixels per output, specified by constant:dev.maxPixs, is halved.</td><td></td><td></td><td></td></tr>
<tr><td>inFormat</td><td></td><td></td><td>String.</td><td></td><td></td><td></td><td><table border="1"><tr><td>"8Bit"</td><td>Each pixel uses one DMX channel.  If the selected pixel-type's "bitRes" value is 8, this is the only permissible value.</td></tr><tr><td>"16BitHL" or "16BitLH"</td><td>Each pixel uses two sequential DMX channels; with the high 8 bits first or the low 8 bits first respectively.</td></tr><tr><td>The format of the incoming DMX channel data.</td><td></td></tr></table></td></tr>
<tr><td>pixsSpanUni</td><td></td><td></td><td>Boolean.</td><td></td><td></td><td></td><td><table border="1"><tr><td>false</td><td>For RGB pixels, universe channels ranging 1 to 510 are consumed and the start channel may be any value in the sequence 1, 4, 7, …, i.e. a multiple of 3 plus 1.  For RGBW pixels, universe channels ranging 1 to 512 are consumed and the start channel may be any value in the sequence 1, 5, 9, …, i.e. a multiple of 4 plus 1.</td></tr><tr><td>true</td><td>For both RGB and RGBW pixels, universe channels ranging 1 to 512 are consumed and the start channel may be any value from 1 to 512.</td></tr><tr><td>Describes if the data of a single pixel is allowed to span consecutive universes.  Spanning a pixel across multiple universes is discouraged because if a universe packet is ever lost, a pixel may temporarily display the wrong color (in some cases).  The member is unused if pix.dataSrc is an "Aux" port, as an auxiliary port can only bear one universe.</td><td></td></tr></table></td></tr>
<tr><td>gammaOn</td><td></td><td></td><td>Boolean.</td><td>Whether gamma correction is to be performed.</td><td></td><td></td><td></td></tr>
<tr><td>gamma</td><td></td><td></td><td>Array of 3 (RGB) or 4 (RGBW) floating point numbers, ranging 1.0 to 3.0.</td><td>The gamma correction values for each color.  The array is for each color of the configured "colorType" of "RGB" or "RGBW" respectively.  The member is only used if "gammaOn" is true.  Reading the configuration, the controller will encode the values to only one decimal place.</td><td></td><td></td><td></td></tr>
<tr><td>ditherOn</td><td></td><td></td><td>Boolean.</td><td>Whether dithering is to be performed.  The member is only used if "gammaOn" is true.</td><td></td><td></td><td></td></tr>
<tr><td>dropFrmOnOvrn</td><td></td><td></td><td>Boolean.</td><td></td><td></td><td></td><td><table border="1"><tr><td>false</td><td>Start sending the new frame of universe data to pixels as soon as the previous output is finished.</td></tr><tr><td>true</td><td>Drop this frame that arrived too early to output so that the next frame of universe data is sure to be output with minimal latency.</td></tr><tr><td>The synchronization of pixel outputs when the incoming frame of universe data is ready before the previous frame is finished being output to the pixels.  Setting this to false may result in less dropped frames if the incoming data is faster than the pixel output process but will prevent synchronization between the universe data and pixel output. It is normally recommended to leave this set to true and slow down the universe data, so the controller can keep up synchronously.</td><td></td></tr></table></td></tr>
<tr><td>holdLastFrm</td><td></td><td></td><td>Boolean.</td><td></td><td></td><td></td><td><table border="1"><tr><td>true</td><td>The outputs keep displaying the last received data.</td></tr><tr><td>false</td><td>The part of an output using that universe data is blanked.</td></tr><tr><td>The behaviour if a universe stops being received (times out).</td><td></td></tr></table></td></tr>
<tr><td>liveIntSrc</td><td></td><td></td><td>String.</td><td></td><td></td><td></td><td><table border="1"><tr><td>"sACN", `Art-Net` or `Aux:N`</td><td>The source for live intensity control.</td></tr><tr><td>""</td><td>Live intensity control is disabled.</td></tr><tr><td>The source of the DMX data for the live intensity control of the pixel outputs.</td><td></td></tr></table></td></tr>
<tr><td>liveIntUni</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>1 to 63999</td><td>pix.liveIntSrc is "sACN".</td></tr><tr><td>1 to 32768</td><td>pix.liveIntSrc is `Art-Net`.</td></tr><tr><td>The universe number for the live intensity control of the pixel outputs.  The member is unused if the "liveIntSrc" is "" or `Aux:N`.</td><td></td></tr></table></td></tr>
<tr><td>liveIntCh</td><td></td><td></td><td>Integer ranging 1 to 512.</td><td>The channel number of the universe for the live intensity control of the pixel outputs.  The member is unused if the "liveIntSrc" is "".</td><td></td><td></td><td></td></tr>
<tr><td>pbMode</td><td></td><td></td><td>String.</td><td></td><td></td><td></td><td><table border="1"><tr><td>"Play"</td><td>Play the recorded content (default).</td></tr><tr><td>"Live"</td><td>Play the existing live content.</td></tr><tr><td>"Blank"</td><td>Blank the outputs.</td></tr><tr><td>"Freeze"</td><td>Freeze the output immediately prior to playback.</td></tr><tr><td>The operation of pixel ports during playback mode.</td><td></td></tr></table></td></tr>
<tr><td>curCtrlGbl</td><td></td><td></td><td>Integer ranging 0 to the selected pixel-type's "curSclGbl" value.</td><td>The current-scale value for pixel-types that support a single global current-control for all colors.</td><td></td><td></td><td></td></tr>
<tr><td>curCtrlCol</td><td></td><td></td><td>Array of 3 (RGB) or 4 (RGBW) integers, ranging 0 to the selected pixel-type's "curSclCol" value.</td><td>The current-scale values for pixel-types that support an independent current-control per color.</td><td></td><td></td><td></td></tr>
<tr><td>pixPort</td><td>pixCount</td><td></td><td></td><td>Each member is an array of pixel port parameters sequenced by port number; starting from port 1.  The number of ports is constant:dev.pixPorts, except when pix.expand is true, in which case the number of pixel ports is doubled.</td><td>Integer.</td><td></td><td><table border="1"><tr><td>0</td><td>The port is unused.</td></tr><tr><td>1 to constant:dev.maxPixs</td><td>pix.colorType is RGB, pix.expand is false.</td></tr><tr><td>1 to constant:dev.maxPixs * ¾</td><td>pix.colorType is RGBW, pix.expand is false.</td></tr><tr><td>Half the above range maximums</td><td>pix.expand is true.</td></tr><tr><td>The number of physical pixels on the pixel port (including null pixels).  If a port is unused, all the parameters of that port are unused.</td><td></td></tr></table></td></tr>
<tr><td>startUni</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>1 to 63999</td><td>pix.dataSrc is "sACN".</td></tr><tr><td>1 to 32768</td><td>pix.dataSrc is `Art-Net`.</td></tr><tr><td>The network universe number where the first pixel's data is obtained from.  The sACN protocol defines universes as ranging 1 to 63999. The Art-Net protocol defines a universe as a 15-bit Port Address comprising 7-bit "Net", 4-bit `Sub-Net` and 4-bit "Universe", and when each part is 0, its equivalent "combined" universe number is 0. Art-Net's "combined" universes range 0 to 32767.  sACN's universe 1 and Art-Net's universe 0 are equivalent, and a change of configuration between sACN and Art-Net modes should not incidentally change the configured "startUni" of each output also.  So the controller models its universe numbers as always ranging from 1.  The client of this API must consider if a conversion is required (+/- 1) between what their UI displays to the user and what the controller expects. In essence, keeping universe numbers starting from 1 allows a configuration change between sACN and Art-Net protocols without having to also change universe numbers (assuming they are within the maximum allowable range).  The member is unused if pix.dataSrc is `Aux:N`, as auxiliary port data does not bear a universe number.</td><td></td></tr></table></td></tr>
<tr><td>startCh</td><td></td><td></td><td>Integer ranging 1 to 512.  If pix.dataSrc = "sACN" or `Art-Net`, additional restrictions apply depending on the value of pix.pixsSpanUni.</td><td>The channel number within the network universe where the first pixel's data starts being obtained from. Successive channels will be used for the remaining data required for the pixel output, including spanning across multiple sequential universes if required.</td><td></td><td></td><td></td></tr>
<tr><td>nullPix</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>0</td><td>No null pixels.</td></tr><tr><td>1 to the port's "pixCount"</td><td>The function is enabled.</td></tr><tr><td>The number of pixels at the beginning of the output that are to be blanked. They are not considered part of the output as far as consuming network data and are not considered as part of the special features (such as zig zag, grouping, reversing). They do count towards the total pixel limit for the output.</td><td></td></tr></table></td></tr>
<tr><td>zigZag</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>1</td><td>No zig-zagging.</td></tr><tr><td>2 to the port's "pixCount"</td><td>The function is enabled.</td></tr><tr><td>The zig zag row size – for a pixel layout organized as a matrix of rows – where the direction of the pixel numbering alternates for each row.</td><td></td></tr></table></td></tr>
<tr><td>group</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>1</td><td>No grouping.</td></tr><tr><td>2 to the port's "pixCount"</td><td>The function is enabled.</td></tr><tr><td>Group consecutive physical pixels so they display as a single pixel. For example, if a pixel string of 150 pixels has a group of 10, the string becomes 15 effective pixels of 10 physical pixels each.</td><td></td></tr></table></td></tr>
<tr><td>reverse</td><td></td><td></td><td>Boolean.</td><td>Reverse the pixel positions so the last physical pixel of the string becomes the first and vice-versa.</td><td></td><td></td><td></td></tr>
<tr><td>colorOrder</td><td></td><td></td><td>A permutation of the colors configured in pix.colorType.  For example, if pix.colorType is "RGB", then the "colorOrder" may be one of "RGB", "RBG", "GRB", "GBR", "BRG", or "BGR".</td><td>This member orders the RGB or RGBW colors and may be used if the pixels of the output have not been wired in a standard order.</td><td></td><td></td><td></td></tr>
<tr><td>intensity</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>0</td><td>Minimum intensity – the output is off.</td></tr><tr><td>1 to 99</td><td>Scaled intensity.</td></tr><tr><td>100</td><td>Maximum intensity.</td></tr><tr><td>Scale the output of the input data by a percentage. It is used in circumstances where the pixels may be too bright. For example, a value of 50 would halve the values to the output's pixels.</td><td></td></tr></table></td></tr>
<tr><td>desc</td><td></td><td></td><td>UTF-8 string of up to 31 octets.</td><td>Optional pixel output port description.</td><td></td><td></td><td></td></tr>
<tr><td>auxPort</td><td>mode</td><td></td><td></td><td>Each member is an array of auxiliary port parameters sequenced by port number; 1 to constant:dev.auxPorts.  Each parameter should be configured.  Each array should be the same size.</td><td>String.</td><td></td><td><table border="1"><tr><td>"Off"</td><td>The port is unused.</td></tr><tr><td>"DMX512Out"</td><td>DMX512 output.</td></tr><tr><td>"DMX512In"</td><td>DMX512 input.</td></tr><tr><td>The mode of the auxiliary port.  If an auxiliary port is configured as the pix.dataSrc, its mode must be configured "DMX512In".  If a port is unused, all the parameters of that port are unused.</td><td></td></tr></table></td></tr>
<tr><td>dataSrc</td><td></td><td></td><td>String of "", "sACN", `Art-Net` or `Aux:N`.</td><td>The source of DMX data.</td><td>These parameters are only used when the port's "mode" is "DMX512Out".</td><td></td><td></td></tr>
<tr><td>uni</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>1 to 63999</td><td>The port's "dataSrc" is "sACN".</td></tr><tr><td>1 to 32768</td><td>The port's "dataSrc" is `Art-Net`.</td></tr><tr><td>The universe number to map from the network to this auxiliary port. Refer the pixPort.startUni member for information about universe numbering.  The parameter is not used if the port's "dataSrc" is an `Aux:N`, as auxiliary port data does not bear a universe number.</td><td></td></tr></table></td></tr>
<tr><td>dropFrmOnOvrn</td><td></td><td></td><td>Boolean.</td><td>The same as pix.dropFrmOnOvrn.</td><td></td><td></td><td></td></tr>
<tr><td>holdLastFrm</td><td></td><td></td><td>Boolean.</td><td></td><td></td><td></td><td><table border="1"><tr><td>true</td><td>The output keeps displaying the last received data.</td></tr><tr><td>false</td><td>The output is blanked.</td></tr><tr><td>The behaviour if a network universe stops being received (times out).</td><td></td></tr></table></td></tr>
<tr><td>liveIntSrc</td><td></td><td></td><td>String.</td><td></td><td></td><td></td><td><table border="1"><tr><td>"sACN", `Art-Net` or `Aux:N`</td><td>The source for live intensity control.</td></tr><tr><td>""</td><td>Live intensity control is disabled.</td></tr><tr><td>The source of the DMX data for the live intensity control of the auxiliary port.</td><td></td></tr></table></td></tr>
<tr><td>liveIntUni</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>1 to 63999</td><td>The port's "liveIntSrc" is "sACN".</td></tr><tr><td>1 to 32768</td><td>The port's "liveIntSrc" is `Art-Net`.</td></tr><tr><td>The universe number for the live intensity control of the auxiliary port.  The parameter is unused if the port's "liveIntSrc" is "" or an `Aux:N`.</td><td>These parameters are only used when the port's "mode" is "DMX512Out".</td></tr></table></td></tr>
<tr><td>liveIntCh</td><td></td><td></td><td>Integer ranging 1 to 512.</td><td>The channel number of the universe for the live intensity control of the auxiliary port.</td><td></td><td></td><td></td></tr>
<tr><td>pbMode</td><td></td><td></td><td>Refer the pix.pbMode member.</td><td>The same as the pix.pbMode.</td><td></td><td></td><td></td></tr>
<tr><td>colorType</td><td></td><td></td><td>Refer the pix.colorType member.</td><td>The color-type of the fixtures.</td><td></td><td></td><td></td></tr>
<tr><td>inFormat</td><td></td><td></td><td>Refer the pix.inFormat member.</td><td>The DMX channel size the fixtures are expecting.</td><td></td><td></td><td></td></tr>
<tr><td>colorOrder</td><td></td><td></td><td>Refer the pixPort.colorOrder member.</td><td>The DMX color order the fixtures are expecting.</td><td></td><td></td><td></td></tr>
<tr><td>trig</td><td>src</td><td></td><td></td><td>Each member is an array of trigger input parameters sequenced by trigger input index; 1 to 3.  Each parameter should be configured.  Each array should be the same size.</td><td>String of "sACN", `Art-Net`, `Aux:N`, or "UDP".</td><td>The list of trigger input sources.</td><td></td></tr>
<tr><td>uniPort</td><td></td><td></td><td>Integer.</td><td></td><td></td><td></td><td><table border="1"><tr><td>1 to 63999</td><td>The trigger's "src" is "sACN".</td></tr><tr><td>1 to 32768</td><td>The trigger's "src" is `Art-Net`.</td></tr><tr><td>1 to 65535</td><td>The trigger's "src" is "UDP".</td></tr><tr><td>The list of trigger input universes or port numbers.  For "sACN" and `Art-Net`, the parameter is the universe to monitor.  For `Aux:N`, the parameter is unused.  For "UDP", the parameter is the UDP port to listen on (see note below.)</td><td></td></tr></table></td></tr>
<tr><td>srcDesc</td><td></td><td></td><td>UTF-8 string of up to 31 octets.</td><td>A list of optional trigger input source descriptions.</td><td></td><td></td><td></td></tr>
<tr><td>ev</td><td></td><td></td><td>Each member is an array of trigger parameters sequenced by trigger index; 1 to 25.  Each parameter should be configured.  Each array should be the same size.</td><td>Object.</td><td>A list of trigger events. Refer Table 16.</td><td></td><td></td></tr>
<tr><td>act</td><td></td><td></td><td>Object.</td><td>A list of trigger actions. Refer Table 21.</td><td></td><td></td><td></td></tr>
<tr><td>desc</td><td></td><td></td><td>UTF-8 string of up to 31 octets.</td><td>A list of optional trigger descriptions.</td><td></td><td></td><td></td></tr>
</table>

Table 15 The `config` object

***Note:*** *UDP ports 68 (DHCP response), 5568 (sACN Data), 6454 (Art-Net Data), and 49151 (Advatek Management) cannot be used and will be rejected by the controller as unavailable.*

#### 7.1.1.1 Trigger Event Object

The "ev" objects of the `config:trig` object configure the events that are monitored. Each event's structure is listed in Table 16.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>op</td><td>String.</td><td><table border="1"><tr><td>"Start"</td><td>The trigger is to fire on start-up.</td></tr><tr><td>"Pat"</td><td>The trigger is to fire on some pattern of channel value being observed on a trigger input's universe.</td></tr><tr><td>"Trig"</td><td>The trigger is to fire on another trigger's starting or ending.</td></tr><tr><td>"Live"</td><td>The trigger is to fire on some change to the availability of live-data.</td></tr><tr><td>"Match"</td><td>The trigger is to fire on a matching on some data being received. Only applicable for a trigger input source of "UDP".</td></tr><tr><td>The trigger's event type.</td><td></td></tr></table></td></tr>
<tr><td>en</td><td>Boolean.</td><td>Whether the event is enabled.</td></tr>
<tr><td>params</td><td>Object.</td><td><table border="1"><tr><td>The event's parameters.</td><td>"Start"</td></tr><tr><td>No parameters.</td><td>"Pat"</td></tr><tr><td>Refer Table 17.</td><td>"Trig"</td></tr><tr><td>Refer Table 18.</td><td>"Live"</td></tr><tr><td>Refer Table 19.</td><td>"Match"</td></tr><tr><td>Refer Table 20.</td><td></td></tr></table></td></tr>
</table>

Table 16 The Trigger Event object

The `params` object of a `Pat` event is listed in Table 17.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>idx</td><td>Integer ranging 1 to MAX_TRIG_INPUTS.</td><td>The trigger input index that this event refers to. This index is used to identify the entries in the trig.src[] and trig.uniPort[] arrays which are to be monitored.</td></tr>
<tr><td>ch</td><td>Integer ranging 1 to 512.</td><td>The universe channel number to monitor.</td></tr>
<tr><td>val</td><td>Array of up to 2 integers, ranging 0 to 255.</td><td>The minimum to maximum value-range of the channel to check, inclusive. Missing array elements will be treated as zero.</td></tr>
<tr><td>sens</td><td>Boolean.</td><td><table border="1"><tr><td>false</td><td>A value outside the range is a match</td></tr><tr><td>true</td><td>A value inside the range is a match.</td></tr><tr><td>The sense of the channel value range.</td><td></td></tr></table></td></tr>
<tr><td>deb</td><td>String.</td><td><table border="1"><tr><td>"VC"</td><td>Value-Change: the trigger will fire when the channel-value changes to any value that is in-range.  This strategy can be used with any size of value-range.</td></tr><tr><td>"OS"</td><td>One-Shot: the trigger will fire when the channel-value transitions from a value that is out-of-range to a value that is in-range.  This strategy requires a size of value-range that is less than [0, 255] (i.e. not full range).</td></tr><tr><td>The debounce strategy.</td><td></td></tr></table></td></tr>
</table>

Table 17 The params object of a Trigger Event of "Pat"

The `params` object of a `Trig` event is listed in Table 18.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>idx</td><td>Integer ranging 1 to MAX_TRIG.</td><td>The trigger index that this event monitors. This indexes the trig.ev[] and trig.act[] arrays. The value of "idx" cannot be the same as its parent's index (e.g. for trig.ev[2].params, idx can be any value from 1 to 25 except 2.)</td></tr>
<tr><td>at</td><td>String.</td><td><table border="1"><tr><td>"Start"</td><td>The action will execute when the referenced trigger's action starts</td></tr><tr><td>"End"</td><td>The action will execute when the referenced trigger's action completes.</td></tr><tr><td>The timing strategy.</td><td></td></tr></table></td></tr>
</table>

Table 18 The params object of a Trigger Event of "Trig"

The `params` object of a `Live` event is listed in Table 19.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>av</td><td>String.</td><td><table border="1"><tr><td>"All"</td><td>The trigger will fire when live-data becomes available on all of the listed outputs.</td></tr><tr><td>"Any"</td><td>The trigger will fire when live-data becomes available on any of the listed outputs.</td></tr><tr><td>"AllUn"</td><td>The trigger will fire when live-data becomes unavailable on all of the listed outputs.</td></tr><tr><td>"AnyUn"</td><td>The trigger will fire when live-data becomes unavailable on any of the listed outputs.</td></tr><tr><td>The availability monitoring strategy.</td><td></td></tr></table></td></tr>
<tr><td>out</td><td>Array of strings of "Pix" or `Aux:N`, where ":N" is an optional Aux port number ranging 1 to constant:dev.auxPorts, and if omitted means `Aux:1`.</td><td>The outputs the event is to monitor.</td></tr>
</table>

Table 19 The params object of a Trigger Event of "Live"

The `params` object of a `Match` event is listed in Table 20.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>idx</td><td>Integer ranging 1 to MAX_TRIG_INPUTS.</td><td>The trigger input index that this event refers to. This index is used to identify the entries in the trig.src[] and trig.uniPort[] arrays which are to be monitored.</td></tr>
<tr><td>dat</td><td>String.</td><td>A base64-encode of the raw data to be matched. The Controller treats the match data as binary. It may have any format, except it must be some multiple of octets in length.  The match data is base64-encoded only so it may be conveyed as a JSON string value.</td></tr>
<tr><td>len</td><td>Integer ranging 0 to 64.</td><td>The raw match data length (without base64 encoding).</td></tr>
<tr><td>typ</td><td>String.</td><td><table border="1"><tr><td>"Start"</td><td>The triggering data may be followed by other data, which is ignored.  It the match data length is zero, any datagram received from the input will trigger.</td></tr><tr><td>"Exact"</td><td>The triggering data must be the same length as the match data.  If the match data length is zero only an empty datagram received from the input will trigger.</td></tr><tr><td>The match strategy.  If omitted, then the default is "Start".</td><td></td></tr></table></td></tr>
</table>

Table 20 The params object of a Trigger Event of "Match"

#### 7.1.1.2 Trigger Actions Object

The "act" objects of the `config:trig` object describe the actions to be taken when the associated trigger event occurs. Each action's structure is listed in Table 21.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>op</td><td>String.</td><td><table border="1"><tr><td>"modeLive"</td><td>Live mode.</td></tr><tr><td>`modeTestData`</td><td>Test-data mode.</td></tr><tr><td>"modePlayback"</td><td>Playback mode.</td></tr><tr><td>"modeRecord"</td><td>Record mode.</td></tr><tr><td>`modeCtrl`</td><td>Mode control.</td></tr><tr><td>`playbackCtrl`</td><td>Playback control.</td></tr><tr><td>"progInt"</td><td>Programmed intensity.</td></tr><tr><td>The action's type is the same as its corresponding request message's `req`.</td><td></td></tr></table></td></tr>
<tr><td>params</td><td>Object.</td><td><table border="1"><tr><td>The action's parameters are the same as its corresponding request message's `params`.</td><td>"modeLive"</td></tr><tr><td>Refer Table 41.</td><td>`modeTestData`</td></tr><tr><td>Refer Table 43.</td><td>"modePlayback"</td></tr><tr><td>Refer Table 45.</td><td>"modeRecord"</td></tr><tr><td>Refer Table 48.</td><td>`modeCtrl`</td></tr><tr><td>Refer Table 51.</td><td>`playbackCtrl`</td></tr><tr><td>Refer Table 52.</td><td>"progInt"</td></tr><tr><td>Refer Table 67.</td><td></td></tr></table></td></tr>
</table>

Table 21 The Trigger Action object

#### 7.1.1.3 Example Config Object

An example of the `config` object is listed in Figure 8.

| {    "net": {      `ipMode`: "Static",      "staticIpAddr": "192.168.0.100",      "staticNetmask": "255.255.225.0",      "staticGateway": "192.168.0.1"    },    "dev": {      "nickname": `PixRow3-E`      "user": [{"typ": `oper`, "en": true}]}],    },    "operIf": {      "layout": "",      "logo": "",      "pal": [],      "colorRes": "8Bit",      "fadeMs": 0    },    "pix": {      "dataSrc": `Art-Net`,      "pixType": "TLS3001",      "colorType": "RGB",      "freq": 800,      "expand": false,      "inFormat": "8Bit",      "pixsSpanUni": false,      "gammaOn": true,      "gamma": [1.8, 2.0, 2.1],      "ditherOn": false,      "dropFrmOnOvrn": true,      "holdLastFrm": false,      "liveIntSrc": `Art-Net`,      "liveIntUni": 0,      "liveIntCh": 1,      `pbMode`: "Play",      "curCtrlGbl": 0,      "curCtrlCol": [0, 0, 0, 0]    },    "pixPort": {      "pixCount": [50, 50, 50, 50],      "startUni": [1, 2, 3, 4],      "startCh": [1, 1, 1, 1],      "nullPix": [0, 0, 0, 0],      "zigZag": [0, 0, 0, 0],      "group": [0, 0, 0, 0],      "reverse": [false, false, false, false],      "colorOrder": ["RGB", "RGB", "RGB", "RGB"],      "intensity": [100, 100, 100, 100],      "desc": ["", "", "", ""]""],    },    "auxPort": {      "mode": ["DMX512Out"],      "dataSrc": [`Art-Net`],      "uni": [1],      "dropFrmOnOvrn": [true],      "holdLastFrm": [false],      "liveIntSrc": [""],      "liveIntUni": [0],      "liveIntCh": [0] ,      `pbMode`: ["Play"],      "colorType": ["RGB"],      "inFormat": ["8Bit"],      "colorOrder": ["RGB"]    },    "trig": {      "src": [`Art-Net`],      "uniPort": [1],      "srcDesc": ["Triggers"],      "ev": [{        "op": "Pat",        `params`: {"idx": 1, "ch": 2, "val": [0, 9], "sens": true, "deb": "VC"}      }],      "act": [{"op": "modeLive"}],      "desc": ["Live"]    }  } |
| --- |

Figure 8 Example `config` object

### 7.1.2 Config Read

The client may read the entire config object, or parts of it, using a `configRead` request. The request's params object is listed in Table 22.

| Name | Values | Description |
| --- | --- | --- |
| path | List of path strings. | Each path string specifies a member of the config object using dot-notation.  An empty string will return the entire config object.  The maximum list size is 10. |

Table 22 The params object of the `configRead` request

The response's result object is listed in Table 23.

| Name | Values | Description |
| --- | --- | --- |
| saved | Boolean. | Whether the controller's running configuration is saved or not. |
| config | Object. | The entire config object, or the requested members to be read. |

Table 23 The result object of the `configRead` response

Examples of the `configRead` request and response messages are listed in Figure 9.

| Case  The client requests to read the entire config object.  The response indicates that the running configuration is saved. | Request Body | {    `req`: `configRead`,    `id`: 1,    `params`: {      `path`: [""]    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `configRead`,    `id`: 1,    `result`: {      `saved`: true,      `config`: {        //…      }    }  } |
| Case  The client requests to read two members of the config object.  The response indicates that the running configuration is unsaved. | Request Body | {    `req`: `configRead`,    `id`: 2,    `params`: {      `path`: ["net", `pix.pixType`]    }  } |
| Response Body | {    `resp`: `configRead`,    `id`: 2,    `result`: {      `saved`: false,      `config`: {        "net": {          //…        },        "pix": {        "pixType": "P9813"        }      }    }  } |

Figure 9 Example `configRead` request and response messages

***Warning:*** *When processing this response, remember to follow the rules for backward compatibility specified in [3.1 API Versioning](#31-api-versioning).*

### 7.1.3 Config Change

The client may change the entire config object, or parts of it, using a `configChange` request. To ensure consistency and completeness, the changes must be made using a single request. The request's params object is listed in Table 24.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th><th></th></tr>
<tr><td>action</td><td>String.</td><td></td><td><table border="1"><tr><td>"apply"</td><td>Change the configuration without saving.</td></tr><tr><td>"save"</td><td>Optionally change the configuration (if a `config` object is included in the request) and save the changes.</td></tr><tr><td>"revert"</td><td>Revert any changes.</td></tr><tr><td>"reset"</td><td>Reset to factory defaults and save the changes.</td></tr><tr><td>The action to be performed on the controller's running configuration.</td><td></td></tr></table></td></tr>
<tr><td>config</td><td>Object.</td><td>This may contain the entire config object, or it may be part(s) of the config object.</td><td>Mandatory for action: "apply".  Optional for action: "save".  Not present for actions: "revert" and "reset".</td></tr>
</table>

Table 24 The params object of the `configChange` request

The response's result object is listed in Table 25.

| Name | Values | Description |
| --- | --- | --- |
| saved | Boolean. | Whether the controller's running configuration is saved or not. |
| config | Object. | The entire config object. |

Table 25 The result object of the `configChange`response

After sending the response, if the request was accepted, the controller also sends a `configChange` notification to all the other WebSocket clients.

***Info:*** *The* *`configChange`* *requests of different clients may race, as it would take some time for one client's request to reach the controller and for the other (WebSocket) clients to receive the controller's notification. The controller will process each request in the order it is received and validate its changes against the controller's current running configuration. Therefore, if more than one client changes the configuration at the same time, a client's previously acceptable change request may have become invalid because of the other client's changes, a moment earlier.*

### 7.1.4 Config-Change Notification

The controller sends a `configChange` notification to the other WebSocket clients anytime the config object is changed. The client that sends a `configChange` request will receive the changed config object in the response and therefore that client is not sent a notification.

The notification's params object is listed in Table 26.

| Name | Values | Description |
| --- | --- | --- |
| saved | Boolean. | Whether the controller's running configuration is saved or not. |
| config | Object. | The entire config object. |

Table 26 The params object of the `configChange` notification

If a `configChange` request changes any of the network parameters, the controller also sends a "disconnect" notification (reason NETWORK_CHANGE) to all WebSocket clients.

An example of the `configChange` request, response, notification and `disconnect` notification messages is listed in Figure 10.

| Case  The client requests to change two members of the config object and applies the configuration without saving it.  The controlleraccepts and then notifies the other WebSocket clients indicating the new configuration and that it is not saved. | Request Body | {    `req`: `configChange`,    `id`: 1,    `params`: {      `action`: "apply",      `config`: {        "net": {          `ipMode`: "DHCP/AutoIP"        },        "pix": {          "dataSrc": `Art-Net`        }      }    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `configChange`,    `id`: 1,    `result`: {      `saved`: false,      `config`: {        //…      }    }  } |
| Notification Body | {    `notify`: `configChange`,    `params`: {      `saved`: false,      `config`: {        //…      }    }  } |
| Disconnect Notification Body (only if network parameters are changed) | {    `notify`: "disconnect",    `params`: {      "reason": {        `code`: 3,        `msg`: "A client has changed network parameters."      }    }  } |

Figure 10 Example `configChange` request, response, notification and "disconnect" notification messages

## 7.2 Constants

### 7.2.1 Constant Object

The controller's information and capabilities are represented by an object named **`constant`,** listed in Table 27.

| Object Path | Name | | Values | Description | |
| --- | --- | --- | --- | --- | --- |
| ver | fw | | String of maximum length 63 characters. | Firmware version. | |
| boot | | String of maximum length 63 characters. | Bootloader version. | |
| hw | | String of maximum length 7 characters. | Hardware version. | |
| dev | prodName | | String of maximum length 63 characters. | Product model name. It describes the type of controller. | |
| prodCode | | Integer. | Unique code that indicates the product's model. | |
| prodFamily | | Integer. | Unique code that indicates the product's family. | |
| prodFamilyName | | String of maximum length 31 characters. | Product family name. | |
| oem | | Integer. | Unique code that indicates the product's OEM. | |
| fwCheckBit | | Number ranging 0 to 255. | Firmware check bit number to be used in firmware-file-validation prior to Firmware Upload. | |
| pixPorts | | Integer ranging 1 to 255. | Number of pixel ports.  Note a product may merge multiple pixel outputs into a single physical connector. | |
| auxPorts | | Integer ranging 0 to 255. | Number of auxiliary ports.  Note a product may have two physical connectors for a single auxiliary port (E.G. Dedicated In and Out, or In and Loop Through). | |
| pwrOut | | Boolean. | Whether or not the pixel outputs can be powered through the controller's outputs (alternatively the controller only outputs the signalling). | |
| pwrBanksIn | | Integer ranging 0 to 255. | Number of monitored power inputs. | |
| pwrPixVolts | | Boolean. | Whether the controller can measure the pixel port output voltage. | |
| maxPixs | | 16 bit integer with minimum value 1. | Maximum number of RGB pixels that can be supported on a pixel output unless config:pix.colorType is "RGBW", in which case the maximum number of pixels is ¾ of this. | |
| maxPixUnis | | Integer ranging 0 to 255. | Maximum total number of universes that can be consumed across all the pixel ports. | |
| ethPorts | | Integer ranging 1 to 255. | Number of physical ethernet ports on the controller. | |
| factIpAddr | | String of decbyte "." Decbyte "." Decbyte "." Decbyte, where decbyte is an integer ranging 0 to 255. | Factory-default IP address. | |
| macAddr | | String of hexbyte-hexbyte-hexbyte-hexbyte-hexbyte-hexbyte,where hexbyte is a 2-digit hexadecimal number ranging 00 to FF. | IEEE 802 LAN MAC address. | |
| pixTypes | Array of object. | pixType | String of maximum length 15 characters. | The name describing the type of chip in the pixels. | These objects list the types of pixels supported by the controller FW and their parameters.  The list is to assist clients to configure a pixel-type without requiring any knowledge of it. |
| colorTypes | A list of strings describing the color-types that the pixel type can support, i.e. ["RGB"] or ["RGBW"] or ["RBG", "RGBW"]. | The color-types supported by the pixel. |
| bitRes | Integer. | The number of data bits per color. |
| canExpand | Boolean. | Whether expanded mode is supported. |
| canDither | Boolean. | Whether the colors can be gamma-corrected using dithering. |
| freqMin | Integer in units of kHz. | The minimum frequency. |
| freqMax | Integer in units of kHz. | The maximum frequency. |
| freqStep | Integer in units of kHz. | The size of the steps that the frequency can range.  If set to 0, the frequency may be configured only the values of "freqMin" or "freqMax". If "freqMin" and "freqMax" are equal, then the frequency can only be configured that value. |
| curSclGbl | Integer. | The number of steps of current control available for pixel-types that support a single global current-control for all colors. |
| curSclCol | Integer. | The number of steps of current control available for pixel-types that support an independent current-control per color. |
| pixMax | Integer | The maximum number of 8-bit RGB pixels which can be supported on each output port in non-expanded mode. |
| pixMaxExp | Integer | The maximum number of 8-bit RGB pixels which can be supported on each output port in expanded mode. |

Table 27 The `constant` object

An example of the `constant` object is listed in Figure 11. Different versions of the controller firmware may have different numbers of pixTypes array elements.

| {    "ver": {      "fw": "1.0.2",      "boot": "1.0.0",      "hw": "1.0"    },    "dev": {      "prodName": "PixLite A4-S Mk3",      "prodCode": 7,      "prodFamily": 1349089331,      "prodFamilyName": "PixLite Mk3",      "oem": 0,      "fwCheckBit": 0,      "pixPorts": 4,      "auxPorts": 1,      "pwrOut": true,      "pwrBanksIn": 1,      "maxPixs": 1020,      "maxPixUnis": 96,      "ethPorts": 2,      "factIpAddr": "192.168.0.50",      "macAddr": `AC-DE-48-00-00-80`    },    "pixTypes": [      {        "pixType": "APA102/APA102C",        "colorTypes": ["RGB"],        "bitRes": 8,        "canExpand": false,        "canDither": true,        "freqMin": 100,        "freqMax": 2500,        "freqStep": 100,        "curSclGlb": 31,        "curSclCol": 0      },      {        "pixType": "TLS3001",        "colorTypes": ["RGB"],        "bitRes": 12,        "canExpand": true,        "canDither": true,        "freqMin": 500,        "freqMax": 1000,        "freqStep": 0,        "curSclGlb": 0,        "curSclCol": 0      }    ]  } |
| --- |

Figure 11 Example `constant` object

### 7.2.2 Constant Read

The client may read the entire constant object, or parts of it, using a `constantRead` request. The request's params object is listed in Table 28.

| Name | Values | Description |
| --- | --- | --- |
| path | List of path strings. | Each path string specifies a member of the constant object using dot-notation.  An empty string will return the entire constant object.  The maximum list size is 10. |

Table 28 The params object of the `constantRead` request

The response's result object is listed in Table 29.

| Name | Values | Description |
| --- | --- | --- |
| constant | Object. | The entire const object, or the requested members to be read. |

Table 29 The result object of the `constantRead` response

Examples of the `constantRead` request and response messages are listed in Figure 12.

| Case  The client requests to read the entire constant object. | Request Body | {    `req`: `constantRead`,    `id`: 1,    `params`: {      `path`: [""]    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `constantRead`,    `id`: 1,    `result`: {      `constant`: {        //…      }    }  } |
| Case  The client requests to read two members of the constant object. | Request Body | {    `req`: `constantRead`,    `id`: 2,    `params`: {      `path`: ["ver", `dev.prodName`]    }  } |
| Response Body | {    `resp`: `constantRead`,    `id`: 2,    `result`: {      `constant`: {        "ver": {          "fw": "1.0.2",          "boot": "1.0.0",          "hw": "1.0"        },        "dev": {          "prodName": "PixLite A4-S Mk3"        }      }    }  } |

Figure 12 Example `constantRead` request and response messages

***Warning:*** *When processing this response, remember to follow the rules for backward compatibility specified in [3.1 API Versioning](#31-api-versioning).*

## 7.3 Disconnect Notification

The controller sends a `disconnect` notification to notify a WebSocket client that it is about to be disconnected and the reason why. The notification's params object is listed in Table 30.

| Name | | Values | Description |
| --- | --- | --- | --- |
| reason | code | Integer. | The reason code. Refer Table 31. |
| msg | String. | A brief description of the reason. |

Table 30 The params object of the "disconnect" notification

After sending the notification, the controller will close the client's WebSocket connection.

An example of the `disconnect` notification message is listed in Figure 13.

| Case  Clients A and B are connected the controller.  Client A changes the password.  This is the disconnect notification message to client B. | Notification Body | {    `notify`: "disconnect",    `params`: {      "reason": {        `code`: 1,        `msg`: "Another client has changed the password."      }    }  } |
| --- | --- | --- |

Figure 13 Example "disconnect" notification message

The reason codes of the `disconnect` notification are integer numbers. Just for documentation, the codes are enumerated in Table 31.

| Reason Code | Enumeration | Description |
| --- | --- | --- |
| 0 | TOO_MANY_CLIENTS | There are too many clients connected. |
| 1 | PASSWORD_CHANGE | The password has changed. |
| 2 | INSTALLING_FW_UPLOAD | The controller is about to restart itself to install new firmware. |
| 3 | NETWORK_CHANGE | The network parameters have changed. This notification would follow a `configChange` notification. |
| 4 | RESTART | The controller has received a "restart" request. |

Table 31 Disconnect reason codes

## 7.4 Firmware Upload

### 7.4.1 Initiate Firmware Upload

The client may initiate a firmware upload to a controller using a `fwUploadStart` request.

Before initiating a firmware upload, the client should inspect certain bytes of the firmware file shown in hexadecimal and highlighted in Figure 14, to confirm the file is a valid firmware for the controller.

![](data:image/png;base64...)

Figure 14 Controller firmware file signature bytes

| Highlighting | Offset (bytes) | Size | Validation Rules |
| --- | --- | --- | --- |
| Green | 4 | 4 bytes | The value encoded little-endian must be 762064481. |
| Blue | 3 | 4 bytes | The value encoded little-endian must be the Device's product family code. |
| Orange | 16 | 32 bytes | The byte at position (fwCheckBit / 8) logically ANDed with the value (1 << (fwCheckBit % 8)) must be non-zero, where   * '/' means integer division, * '%' means remainder of the integer division, and * '<<' means left shift.   The value of fwCheckBit may be found at constant:dev.fwCheckBit or in the version response. |

Table 32 Legend of the highlight colors for Figure 14

The request's params object is listed in Table 33.

| Name | Values | Description |
| --- | --- | --- |
| size | Integer. | The size of the firmware file in octets. |

Table 33 The params object of the `fwUUploadStart` request

The response's result object is listed in Table 34.

| Name | Values | Description |
| --- | --- | --- |
| blockLen | Integer. | The firmware file is too large to be sent as one packet, so it must be split into blocks. This is the controller's maximum block length. |

Table 34 The result object of the `fwUploadStart` response

If the controller accepts the request to begin a firmware upload, the client should commence sending the firmware file in parts (blocks), until the entire file is transferred.

***Warning:*** *When the controller accepts the firmware upload, the client should immediately start sending its block requests. The controller may time-out the firmware upload if a block is not received within 5 seconds.*

Examples of the `fwUploadStart` request and response messages are listed in Figure 15.

| Case  This client requests to upload firmware and the controller accepts, with a maximum 1KB block size.  The client may send the first firmware file block next. | Request Body | {    `req`: `fwUploadStart`,    `id`: 1,    `params`: {      "size": 552977    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `fwUploadStart`,    `id`: 1,    `result`: {      "blockLen": 1024    }  } |
| Case  This client requests to upload firmware but the controller reject with BUSY_ERROR, because another client is already uploading firmware. | Request Body | {    `req`: `fwUploadStart`,    `id`: 2,    `params`: {      "size": 552977    }  } |
| Response Body | {    `resp`: `fwUploadStart`,    `id`: 2,    "err": {      `code`: 7,      `msg`: "Another client is already uploading firmware."    }  } |

Figure 15 Example `fwUploadStart` request and response messages

### 7.4.2 Send Firmware Block

`Request`

After initiating a firmware upload, the client is to send the firmware file one block at a time using a `fwUploadBlock` request. The client must have already initiated a firmware upload before sending blocks.

The request is **binary, not JSON text.** If using WebSocket, the frame is **Opcode Binary.** If using HTTP, the Content-Type header is **"application/octet-stream".**

The request is defined in Table 35. All its multi-byte fields are in network byte order (big-endian, most-significant-byte first).

| Byte Offset | Size (bytes) | Field Name | Value | Description |
| --- | --- | --- | --- | --- |
| 0 | 16 | Type | String `fwUploadBlock`. | The message's type in ASCII characters. To be padded to 16 bytes by zero (0). |
| 16 | 4 | Id | Integer ranging 1 to 4294967295. | If the id is 0, there will be no id member in the JSON response. |
| 20 | 4 | Block offset | Integer ranging 0 to length of the firmware file. | The offset of the block in bytes. |
| 24 | Length to the end of the message | Block | Binary bytes. | A block of the firmware file. |

Table 35 The binary `fwUploadBlock` request

The method for sending firmware blocks:

1. The block offset of the first firmware block request must be 0.
2. The successive block offsets must increase by the size of the previous block.
3. The block length must never exceed the "blockLen" indicated in the firmware upload response. Where possible a client should use the indicated block length for all blocks, except for the last block which may need to be less.
4. The client must wait for the `fwUploadBlock` response before sending the next block.

`Response`

Unlike the request, the `fwUploadBlock` response is **JSON text.** The response has no result object.

Before sending the last firmware block response, the controller checks the integrity of the uploaded firmware. This may take up to ten seconds.

If the received firmware is valid, the controller will:

1. Send the last firmware block response.
2. Send a `disconnect` notification to all WebSocket clients.
3. Close all active WebSocket client connections.
4. Restart itself to install the uploaded firmware.

***Warning:*** *Only one client can upload firmware at a time. The controller may time-out a firmware upload session if the client takes more than five seconds to send the next block request after each response.*

Examples of the `fwUploadBlock` request and response messages are listed in Figure 16. They are hypothetical messages with the following properties:

* The controller's requested block size for the firmware upload is 32 bytes (this number is very low, just to simplify the examples).
* The firmware file the client is trying to upload is 552,977 bytes total size.

| Case  The client sends the first 32-byte block to the controller.  The controller accepts. | Request Body | Offset(h) 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  00000000 66 77 55 70 6C 6F 61 64 42 6C 6F 63 6B 00 00 00 fwUploadBlock…  00000010 00 00 00 01 00 00 00 00 96 52 74 26 61 2E 6C 2D …......Rt&a.l-  00000020 33 78 69 50 00 00 00 00 A0 61 08 00 CE BC D6 F1 3xiP…a..Î¼Öñ{  00000030 7B 45 6E 64 78 0C F7 CB {Endx.÷Ë |
| --- | --- | --- |
| Response Body | {    `resp`: `fwUploadBlock`,    `id`: 1  } |
| Case  The client sends the second 32-byte block to the controller.  The controller accepts. | Request Body | Offset(h) 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  00000000 66 77 55 70 6C 6F 61 64 42 6C 6F 63 6B 00 00 00 fwUploadBlock…  00000010 00 00 00 02 00 00 00 20 C9 46 07 25 CE BC D6 F1 ….... ÉF.%Î¼Öñ  00000020 7B 45 6E 64 78 0C F7 CB C9 46 07 25 35 3A 33 30 {Endx.÷ËÉF.%5:30  00000030 3A 32 39 27 32 30 0D 0A |
| Response Body | {    `resp`: `fwUploadBlock`,    `id`: 2  } |
| Case  The client sends the last block of the file to the controller (which is only 17 bytes).  The controller has a short delay while it verifies the firmware received, then accepts the block, indicating the transfer was successful.  Since the transfer is complete, the controller sends a `disconnect` notification to all WebSocket clients before restarting to install the firmware. | Request Body | Offset(h) 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  00000000 66 77 55 70 6C 6F 61 64 42 6C 6F 63 6B 00 00 00 fwUploadBlock…  00000010 00 00 00 03 00 08 70 00 CF 4F 2C 5B 17 34 3D 96 ÏO,[.4=–  00000020 08 B5 FE CC A1 FE 07 5F 88 DA AE B4 00 9C 93 96 .µþÌ¡þ._ˆÚ®´.œ"–  00000020 12 |
| Response Body | {    `resp`: `fwUploadBlock`,    `id`: 3  } |
| Notification Body | {    `notify`: "disconnect",    `params`: {      "reason": {        `code`: 2,        `msg`: "Restarting to install firmware."      }    }  } |

Figure 16 Exampe `fwUploadBlock` request, response and "disconnect" notification messages

## 7.5 Identify

The client may visually locate a controller, by the controller flashing a distinct pattern on its status LED, using an `identify` request. The function is independent of the controller's "mode" and it overrides the status LED's normal behaviour until it completes. The request's params object is listed in Table 36.

<table>
<tr><th>Name</th><th>Values</th><th>Default</th><th>Description</th></tr>
<tr><td>duration</td><td>Integer.</td><td></td><td><table border="1"><tr><td>0</td><td>The identify function is to be disabled.</td></tr><tr><td>1..120</td><td>The time in seconds the identify function is to operate.</td></tr><tr><td>121</td><td>The identify function is to execute continuously, or until either a client disables it or the controller is powered down or restarted.</td></tr><tr><td>120</td><td>The duration of the identify function in seconds.  The identify function's duration can be changed or disabled by a subsequent "identify" request. Also, enabling the identify function on one controller will automatically disable it on all the other controllers on its subnet.</td></tr></table></td></tr>
</table>

Table 36 The params object of the "identify" request

The response's result object is listed in Table 37.

| Name | Values | Description |
| --- | --- | --- |
| status | Object. | The entire status object. |

Table 37 The result object of the "identify" response

After sending the response, if the request was accepted, the controller also sends a `statusChange` notification to all the other WebSocket clients and, if the duration is less than 121, a `statusChange` notification to all the WebSocket clients each second until it has decremented status:identify to zero.

An example of the `identify` request, response and `statusChange` notification messages is listed in Figure 17.

| Case  This controller was already in live mode and the client requests the identify function to run until otherwise stopped.  The controller accepts and then notifies the other WebSocket clients indicating the new status. | Request Body | {    `req`: "identify",    `id`: 1,    `params`: {      "duration": 121    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: "identify",    `id`: 1,    `result`: {      `status`: {        "mode": "live",        //…        "identify": 121      }    }  } |
| Notification Body | {    `notify`: `statusChange`,    `params`: {      `status`: {        "mode": "live",        //…        "identify": 121      }    }  } |

Figure 17 Example "identify" request, response and `statusChange` notification messages

***Warning:*** *if a* `statusChange` *notification indicates an identify value of 121, the identify function's execution is indefinite.*

## 7.6 Import/Export

### 7.6.1 Export

The client may export a controller's running configuration, in a form suitable for subsequent imports, using an `export` request. The request has no params object.

The response's result object is listed in Table 38.

| Name | Values | Description |
| --- | --- | --- |
| saved | Boolean. | Informational only. |
| exportDat | Object. | The export data to be used in subsequent import requests. |

Table 38 The result object of the "export" response

An example of the `export` request and response messages is listed in Figure 18.

| Case  The client requests to export the controller's running configuration | Request Body | {    `req`: "export",    `id`: 1  } |
| --- | --- | --- |
| Response Body | {    `resp`: "export",    `id`: 1,    `result`: {      `saved`: true,      "exportDat": {        "apiVer": {          "maj": "v1",          "min": 0        },        "prodFamily": 1349089331,        "pixPorts": 16,        "auxPorts": 1,        `config`: {          //…        }      }    }  } |

Figure 18 Example "export" request and response messages

### 7.6.2 Import

The client may import a controller's previously exported configuration, using an `import` request. The request's params object is listed in Table 39.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>action</td><td>String.</td><td><table border="1"><tr><td>"apply"</td><td>Change the configuration without saving.</td></tr><tr><td>"save"</td><td>Change the configuration and save the changes.</td></tr><tr><td>The action to be performed on the controller's running configuration.</td><td></td></tr></table></td></tr>
<tr><td>exportDat</td><td>Object.</td><td>The export data of a previous export request, to be imported to the controller's configuration.</td></tr>
</table>

Table 39 The params object of the "import" request

***Note:*** *The controller may reconstitute the configuration as it imports if the controller the configuration was exported from had different capabilities (e.g. number of physical ports) or if the exported data was of an earlier API version. This will automatically occur, so there is no need for the client to consider different capabilities.*

***Note:*** *An import will reset the passwords of the administrator and operator users to their exported values.*

The response's result object is listed in Table 40.

| Name | Values | Description |
| --- | --- | --- |
| saved | Boolean. | Whether the controller's running configuration is saved or not. |
| Config | Object. | The entire reconstituted config object. |

Table 40 The result object of the "import" response

The same as a `configChange` request, after sending the response, if the request was accepted, the controller sends a `configChange` notification to all the other WebSocket clients. If the import changed network parameters, the controller also sends a `disconnect` notification (reason NETWORK_CHANGE) to all WebSocket clients.

An example of the `import` request, response**, `configChange`** notification and `disconnect` notification messages is listed in Figure 19.

| Case  The client requests to import a configuration to the controller's running configuration | Request Body | {    `req`: "import",    `id`: 1,    `params`: {      `action`: "apply",      "exportDat": {        "apiVer": {          "maj": "v1",          "min": 0        },        "prodFamily": 1349089331,        "pixPorts": 16,        "auxPorts": 1,        `config`: {          //…        }      }    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: "import",    `id`: 1,    `result`: {      `saved`: false,      `config`: {        //…      }    }  } |
| Config change notification Body | Refer [7.1.3 Config Change](#713-config-change). |
| Disconnect Notification Body (only if network parameters are changed) |

Figure 19 Example "import" request, response, and `configChange` and "disconnect" notification messages

## 7.7 Modes

### 7.7.1 Live Mode

In live mode, the controller uses data from its configured inputs as the source for pixel outputs and any auxiliary outputs.

The client may change to live mode using a `modeLive` request. The request's params object is listed in Table 41.

| Name | Values | Default | Description |
| --- | --- | --- | --- |
| fadeMs | Integer ranging 0 to 4294967295. | 0 | The fade time in milliseconds to apply on the transition to the mode. |

Table 41 The params object of the "modeLive" request

The response's result object is listed in Table 42.

| Name | Values | Description |
| --- | --- | --- |
| status | Object. | The entire status object. Refer [7.14.1 Status Object](#7141-status-object). |

Table 42 The result object of the "modeLive" response

After sending the response, if the request was accepted, the controller also sends a `statusChange` notification to all the other WebSocket clients.

An example of the `modeLive` request, response and `statusChange` notification messages is listed in Figure 20.

| Case  The client requests the controller run in live mode.  The controller accepts and then notifies the other WebSocket clients of the mode change using a status change notification message. | Request Body | {    `req`: "modeLive",    `id`: 1  } |
| --- | --- | --- |
| Response Body | {    `resp`: "modeLive",    `id`: 1,    `result`: {      `status`: {        "mode": "live",        //…      }    }  } |
| Notification Body | {    `notify`: `statusChange`,    `params`: {      `status`: {        "mode": "live",        //…      }    }  } |

Figure 20 Example "modeLive" request, response and `statusChange` notification messages

### 7.7.2 Test Data Mode

In test-data mode, the controller synthesizes data internally for pixel outputs and any auxiliary outputs. It is designed to help an operator confirm the function of the outputs without requiring an input source.

The client may change to test-data mode using a `modeTestData` request. The request's params object is listed in Table 43.

<table>
<tr><th>Name</th><th>Values</th><th>Default</th><th>Description</th><th></th></tr>
<tr><td>op</td><td>String.</td><td></td><td></td><td><table border="1"><tr><td>"rgbwCycle"</td><td>RGBW-cycle the pixels.</td></tr><tr><td>"colorFade"</td><td>Color-fade the pixels.</td></tr><tr><td>"setColor"</td><td>Set the color of the pixels.</td></tr><tr><td>Must be specified.</td><td>The operation to perform.</td></tr></table></td></tr>
<tr><td>color</td><td>Array of 4 integers, ranging 0 to MAX_COLOR_VALUE, where MAX_COLOR_VALUE is 255 if colorRes is "8Bit", or 65535 if colorRes is "16Bit".</td><td>[0, 0, 0, 0]</td><td>The Red, Green, Blue, and White color values respectively.  The White element of the array is only used if config:pix.colorType is "RGBW".</td><td>These members are only used if "op" is "setColor".</td></tr>
<tr><td>colorRes</td><td>String of "8Bit" or "16Bit".</td><td>"8Bit"</td><td>The resolution of the "color" array values.</td><td></td></tr>
<tr><td>pixPortNum</td><td>Integer.</td><td></td><td></td><td><table border="1"><tr><td>1..constant: dev.pixPorts</td><td>config:pix.expand is false</td></tr><tr><td>The individual pixel port number to test.</td><td>1..constant: dev.pixPorts*2</td></tr><tr><td>config:pix.expand is true</td><td>0</td></tr><tr><td>Test all the pixel ports.</td><td>0</td></tr><tr><td>The pixel ports to be tested. If an individual port is being tested, the pixels of the other ports are blanked (off).</td><td></td></tr></table></td></tr>
<tr><td>pixNum</td><td>Integer.</td><td></td><td></td><td><table border="1"><tr><td>1..constant: dev.maxPixs</td><td>The individual pixel number to test. The other pixels are blanked (off).</td></tr><tr><td>0</td><td>Test all the pixels.</td></tr><tr><td>0</td><td>The pixels to be tested.  If "pixNum" is beyond a port's config:pixPort.pixCount, none of the pixels of that port would be tested.</td></tr></table></td></tr>
</table>

Table 43 The params object of the `modeTestData` request

The response's result object is listed in Table 44.

| Name | Values | Description |
| --- | --- | --- |
| status | Object. | The entire status object. Refer [7.14.1 Status Object](#7141-status-object). |

Table 44 The result object of the `modeTestData` response

After sending the response, if the request was accepted, the controller also sends a `statusChange` notification to all the other WebSocket clients.

An example of the `modeTestData` request, response and `statusChange` notification messages is listed in Figure 21.

| Case  The client requests the controller run in test-data mode.  The controller accepts and then notifies the other WebSocket clients indicating the new status. | Request Body | {    `req`: `modeTestData`,    `id`: 1,    `params`: {      "op": "setColor",      "color": [0, 100, 255, 0],      "colorRes": "8Bit",      "pixPortNum": 0,      "pixNum": 0    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `modeTestData`,    `id`: 1,    `result`: {      `status`: {        "mode": `testData`,        `params`: {          "op": "setColor",          "color": [0, 100, 255, 0],          "colorRes": "8Bit",          "pixPortNum": 0,          "pixNum": 0        },        //…      }    }  } |
| Notification Body | {    `notify`: `statusChange`,    `params`: {      `status`: {        "mode": `testData`,        `params`: {          "op": "setColor",          "color": [0, 100, 255, 0],          "colorRes": "8Bit",          "pixPortNum": 0,          "pixNum": 0        },        //…      }    }  } |

Figure 21 Example `modeTestData` request, response and `statusChange` notification messages

### 7.7.3 Playback Mode

In playback mode, the controller can play one of the following types of scenes:

* A blank scene, which turns the outputs off.
* A freeze scene, which "freezes" the outputs.
* A color scene, which sets the outputs to a particular color.
* A recorded scene file from its microSD card, containing pixel and/or auxiliary output data. Recorded scene files have an ".scn" extension.
* A playlist file from its microSD card, which lists of any of the above scene types to be played in sequence. Playlist files have a ".pl" extension.

The client may change to playback mode using a `modePlayback` request. The request's params object is listed in Table 45.

<table>
<tr><th>Name</th><th>Values</th><th>Default</th><th>Description</th><th></th></tr>
<tr><td>op</td><td>String.</td><td></td><td></td><td><table border="1"><tr><td>"File"</td><td>Play a recorded scene or playlist file.</td></tr><tr><td>"Blank"</td><td>Blank the outputs.</td></tr><tr><td>"Freeze"</td><td>Freeze the outputs.</td></tr><tr><td>"Color"</td><td>Set the color of the outputs.</td></tr><tr><td>Must be specified.</td><td>The playback operation.</td></tr></table></td></tr>
<tr><td>file</td><td>UTF-8 string of up to 63 octets.</td><td>Must be specified.</td><td>The filename of the recorded scene or playlist to play.  The file must be in the root directory of the microSD card.</td><td>These members are only used if "op" is "File".</td></tr>
<tr><td>cnt</td><td>Integer.</td><td></td><td></td><td><table border="1"><tr><td>1 to 65535</td><td>The number of times.</td></tr><tr><td>0</td><td>Infinite.</td></tr><tr><td>0</td><td>The number of times the file is to be played. Cannot have both cnt and durMs parameters at the same time.</td></tr></table></td></tr>
<tr><td>color</td><td>Array of 4 integers, ranging 0 to MAX_COLOR_VALUE, where MAX_COLOR_VALUE is 255 if colorRes is "8Bit", or 65535 if colorRes is "16Bit".</td><td>[0, 0, 0, 0]</td><td>The Red, Green, Blue, and White color values respectively.  The White element of the array is only used if config:pix.colorType is "RGBW".</td><td>These members are only used if "op" is "Color".</td></tr>
<tr><td>colorRes</td><td>String of "8Bit" or "16Bit".</td><td>"8Bit"</td><td>The resolution of the "color" array values.</td><td></td></tr>
<tr><td>durMs</td><td>Integer.</td><td></td><td></td><td><table border="1"><tr><td>1 to 4294967295</td><td>The duration.</td></tr><tr><td>0</td><td>Infinite.</td></tr><tr><td>0</td><td>The duration to be played in milliseconds. Cannot have both cnt and durMs parameters at the same time.</td></tr></table></td></tr>
<tr><td>fadeMs</td><td>Integer ranging 0 to 4294967295.</td><td>0</td><td>The fade time in milliseconds to apply on the transition to the mode.</td><td></td></tr>
</table>

Table 45 The params object of the "modePlayback" request

The request will be rejected if its "file" member is incorrectly named or is not found.

If the playback operation is to play a recorded scene, only one of the "cnt" or "durMs" members can be used.

If the playback operation is to play a playlist, the "durMs" member cannot be used.

The response's result object is listed in Table 46.

| Name | Values | Description |
| --- | --- | --- |
| status | Object | The entire status object. Refer [7.14.1 Status Object](#7141-status-object). |

Table 46 The result object of the "modePlayback" response

After sending the response, if the request was accepted, the controller also sends a `statusChange` notification to all the other WebSocket clients, and then to all the WebSocket clients every second until the mode completes. It is recommended that HTTP clients manually poll the mode's progress using `statusRead` requests.

Refer [7.14.1.1 State Object](#71411-state-object) for a description of the playback mode's status:state object.

**Playlist files**

Prior to API v1.5, playlist files were arrays of "modePlayback" params objects. From API v1.5, playlist files are an object as listed in Table 47.

| Name | Values | Description |
| --- | --- | --- |
| attr | UTF-8 string of not less than 1 octet. | The file's attributes as listed in Table 55. |
| scenes | Array of "modePlayback" params objects. | As listed in Table 45. |

Table 47 Playlist file definition

The change to the playlist definition was to facilitate controlling the visibility of playlist files in the SPA's dashboard of operator users. The controller supports both playlist definitions.

An example playlist file is listed in Figure 22.

| Case  A playlist file of three scenes. | {  "attr": "v",  "scenes": [  {"op": "File", "file": "Rainbow Wave.scn", "cnt": 1, "fadeMs": 500},  {"op": "File", "file": "Dancing Colors.scn", "cnt": 1, "fadeMs": 500},  {"op": "Color", "color": [0, 100, 255, 0], "durMs": 2000, "fadeMs": 500}  ]  } |
| --- | --- |

Figure 22 Example playlist file

### 7.7.4 Record Mode

In this mode the controller records the incoming data being used to drive the pixels and/or the auxiliary output(s) into a file so that the outputs can be replayed.

The client may change to record mode using a `modeRecord` request. The request's params object is listed in Table 48.

<table>
<tr><th>Name</th><th>Values</th><th>Default</th><th>Description</th></tr>
<tr><td>file</td><td>UTF-8 string of up to 63 octets.</td><td>Missing</td><td>The filename to record the scene to.  The filename must have an extension of ".scn" and include no path information.  The file will be created in the root directory of the microSD card.  If this member is missing, the controller will automatically assign a filename of the form `Auto-nnnnn.scn`</td></tr>
<tr><td>start</td><td>Object.</td><td>Missing</td><td>A condition to start the recording. If this member is missing the recording will start immediately. Refer Table 49.</td></tr>
<tr><td>stop</td><td>Object.</td><td>Missing</td><td>A condition to stop the recording. Refer Table 49.</td></tr>
<tr><td>durMs</td><td>Integer.</td><td></td><td><table border="1"><tr><td>1 to 4294967295</td><td>The duration.</td></tr><tr><td>0</td><td>Infinite.</td></tr><tr><td>0</td><td>The duration to be recorded in milliseconds.</td></tr></table></td></tr>
</table>

Table 48 The params object of the "modeRecord" request

The objects of the optional "start" and "stop" conditions describe a DMX condition the controller is to await before starting or stopping the recording respectively. The members of these condition objects are listed in Table 49.

<table>
<tr><th>Name</th><th>Values</th><th>Default</th><th>Description</th><th></th></tr>
<tr><td>op</td><td>String.</td><td></td><td></td><td><table border="1"><tr><td>""</td><td>No condition.</td></tr><tr><td>"Any"</td><td>On a change of any channel of the universe specified by "src" and "uni".</td></tr><tr><td>"Uni"</td><td>On a change of the "ch" channel of the universe specified by "src" and "uni".</td></tr><tr><td>Must be specified.</td><td>The condition that starts or stops the recording.</td></tr></table></td></tr>
<tr><td>src</td><td>String of "sACN", `Art-Net` or `Aux:N`.</td><td>Must be specified.</td><td>The source of the universe to be checked.</td><td>These members are only used if "op" is "Uni".</td></tr>
<tr><td>uni</td><td>For "src" of "sACN": integer ranging 1 to 63999.  For "src" of `Art-Net`: integer ranging 1 to 32768.</td><td>Must be specified.</td><td>The universe number.  This member is not used if "src" is an "Aux" port.</td><td></td></tr>
<tr><td>ch</td><td>Integer ranging 1 to 512.</td><td>Must be specified.</td><td>The channel number within the universe.</td><td></td></tr>
<tr><td>val</td><td>Array of 2 integers, ranging 0 to 255.</td><td>[]</td><td>The range of minimum and maximum channel values. Inclusive.</td><td></td></tr>
<tr><td>sens</td><td>Boolean.</td><td></td><td></td><td><table border="1"><tr><td>false</td><td>A value outside the range is a match.</td></tr><tr><td>true</td><td>A value inside the range is a match.</td></tr><tr><td>False</td><td>The sense of the "val" range.</td></tr></table></td></tr>
<tr><td>cnt</td><td>Integer ranging 0 to 65535.</td><td>0</td><td>The number of times the start or stop condition must be matched before the recording is started or stopped respectively.</td><td></td></tr>
</table>

Table 49 The "start" and "stop" objects of the "modeRecord" request's params

The "cnt" field in the start and stop objects is interpreted in the following way:

* If this field is omitted or included with its default value of zero (0) then the recording will start or stop (as appropriate) immediately upon a match of the condition being present. If both start and stop conditions are similar and the stop condition has a "cnt" field of zero then typically only a single frame will be recorded. This matches the behaviour of firmware versions up to API v1.2.
* If this field has a non-zero value then the recording will start or stop (as appropriate) only after the specified number of transitions from a non-match condition to the specified match condition.

The behaviour of the start and stop conditions with non-zero "cnt" parameters is useful to allow frame-accurate recording of cyclical patterns.

The response's result object is listed in Table 50.

| Name | Values | Description |
| --- | --- | --- |
| status | Object. | The entire status object. Refer [7.14.1 Status Object](#7141-status-object). |

Table 50 The result object of the "modeRecord" response

After sending the response, if the request was accepted, the controller also sends a `statusChange` notification to all WebSocket clients excluding the client that sent the request, and then every second to all WebSocket clients until the mode completes. It is recommended that HTTP clients manually poll the mode's progress using `statusRead` requests.

Refer [7.14.1.1 State Object](#71411-state-object) for a description of modeRecord's status:state object.

## 7.8 Controls

### 7.8.1 Mode Control

The client may control the mode in progress using a `modeCtrl` request. The request's params object is listed in Table 51.

<table>
<tr><th>Name</th><th>Values</th><th>Default</th><th>Description</th></tr>
<tr><td>op</td><td>String.</td><td></td><td><table border="1"><tr><td>"Stop"</td><td>If the current mode is transient, switch to the last continuous mode, and if the last continuous mode is resumable, resume it.  If the current mode is continuous, does nothing.</td></tr><tr><td>"Rst"</td><td>Restart the current mode, if it is restartable.  At present, modeRecord and modePlayback are the only restartable modes.</td></tr><tr><td>Must be specified.</td><td>The mode control operation.</td></tr></table></td></tr>
<tr><td>fadeMs</td><td>Integer ranging 0 to 4294967295.</td><td>0</td><td>The fade time in milliseconds to apply on the transition to the operation.</td></tr>
</table>

Table 51 The params object of the `modeCtrl` request

If the request was accepted, the response's result object will include the status object, and after sending the response, the controller will also send a `statusChange` notification to all the other WebSocket clients.

### 7.8.2 Playback Control

The client may control the playback in progress using a `playbackCtrl` request. The request's params object is listed in Table 52.

<table>
<tr><th>Name</th><th>Values</th><th>Default</th><th>Description</th></tr>
<tr><td>op</td><td>String.</td><td></td><td><table border="1"><tr><td>"Paus"</td><td>Pause.</td></tr><tr><td>These operations are valid during any playback.</td><td>"Play"</td></tr><tr><td>Play.</td><td>"PausTog"</td></tr><tr><td>Toggle Pause/Play.</td><td>"Rst"</td></tr><tr><td>Restart current item.</td><td>"Prv"</td></tr><tr><td>Skip to previous item.</td><td>These operations are only valid during playlist playback.</td></tr><tr><td>"Nxt"</td><td>Skip to next item.</td></tr><tr><td>"PrvRec"</td><td>Skip to previous recorded scene.</td></tr><tr><td>"NxtRec"</td><td>Skip to next recorded scene.</td></tr><tr><td>Must be specified.</td><td>The playback control operation.</td></tr></table></td></tr>
<tr><td>fadeMs</td><td>Integer ranging 0 to 4294967295.</td><td>0</td><td>The fade time in milliseconds to apply on the transition to the operation.</td></tr>
</table>

Table 52 The params object of the `playbackCtrl` request

The "Rst", "Prv", "Nxt", "PrvRec" and "NxtRec" operations all resume a pause.

The "Nxt" and "NextRec" operations will skip from the end to the first or the first recorded scene respectively from the start of the playlist. But, if the playback request had specified a non-zero count ("cnt"), the playback is on its last count and the skip passes the last item of the playlist, the playback will complete.

The "Prv" and "PrvRec" operations will stop if the start of the playlist is reached, i.e. it will not skip from the start of the playlist to its end.

The response has no result object. If the request was accepted, after sending the response, the controller also sends a `statusChange` notification to every WebSocket client.

## 7.9 File Management

A microSD card may be used for the storage of recorded scenes and playlists.

The requests in this section allow the management of the microSD card and its files.

### 7.9.1 Format MicroSD Card

Formatting the microSD card will erase all files on the card.

The client may format the microSD card using a `format` request. The request's params object is listed in Table 53.

| Name | Values | Description |
| --- | --- | --- |
| fs | "FAT32" | The filesystem to format. |

Table 53 The params object of the "format" request

The response's result object includes the status object.

After sending the response, if the request was accepted, the controller also sends a `statusChange` notification to all the other WebSocket clients.

When the formatting completes, the controller sends a `statusChange` notification to all WebSocket clients.

### 7.9.2 File Attribute

The client may change the visibility of recorded scene and playlist files in the SPA's dashboard of operator users. The request's params object is listed in Table 54.

| Name | Values | Description |
| --- | --- | --- |
| file | UTF-8 string of up to 63 octets. | The name of the file. |
| attr | UTF-8 string of not less than 1 octet. | The file's attributes as listed in Table 55. |

Table 54 The params object of the "fileAttr" request

The file attribute values are listed in Table 55.

| Position (octets) | Value | Description |
| --- | --- | --- |
| 0 | 'h' | The file is hidden. |
| 'v' | The file is visible. |
| All other positions. | Reserved. | |

Table 55 File attribute values

The request may be rejected for the following reasons:

* There is no microSD card, or the microSD card is being formatted,
* There is a recording in progress,
* The file is neither a recorded scene ("*.scn") nor a playlist ("*.pl"),
* The file is a playlist ("*.pl") that is of an API version less than v1.5 (refer Table 47).

The response has no result object. If the request was accepted, after sending the response, the controller also sends a `fileChange` notification to all the other WebSocket clients.

### 7.9.3 File Rename

The client may rename a file on the microSD card using a `fileRen` request. The request's params object is listed in Table 56.

| Name | Values | Description |
| --- | --- | --- |
| file | UTF-8 string of up to 63 octets. | The name of the file to rename. |
| newFile | UTF-8 string of up to 63 octets. | The file's new name. |

Table 56 The params object of the "fileRen" request

The request will be rejected if there is no microSD card, the microSD card is being formatted or there is a recording in progress. Wildcard characters are not allowed in either the "file" or "newFile" members, and a file of the "newFile" name must not exist.

The response has no result object. If the request was accepted, after sending the response, the controller also sends a `fileChange` notification to all the other WebSocket clients.

### 7.9.4 File Delete

The client may delete files on the microSD card using a `fileDel` request. The request can delete up to 10 files from the microSD card. The request's params object is listed in Table 57.

| Name | Values | Description |
| --- | --- | --- |
| file | An array of up to 10 UTF-8 strings, each up to 63 octets. | The name of the file(s) to delete. |

Table 57 The params object of the "fileDel" request

The request will be rejected if there is no microSD card, the microSD card is being formatted or there is a recording in progress. Wildcard characters are not allowed in the filenames of the "file" member.

The response has no result object. If the request was accepted, after sending the response, the controller also sends a `fileChange` notification to all the other WebSocket clients.

### 7.9.5 File List

The client may list the files on the microSD card using a `fileList` request. The request's params object is listed in Table 58.

<table>
<tr><th>Name</th><th>Values</th><th>Default</th><th>Description</th></tr>
<tr><td>pattern</td><td>Array of up to 4 UTF-8 strings of up to 63 octets.</td><td>None</td><td><table border="1"><tr><td>Patterns describing the files to be listed.  Patterns may include wildcards:</td><td>?</td></tr><tr><td>Ignore one character.</td><td>*</td></tr><tr><td>Ignore any number of characters.</td><td></td></tr></table></td></tr>
</table>

Table 58 The params object of the "fileList" request

The request will be rejected if there is no microSD card, the microSD card is being formatted or there is a recording in progress.

The response's result object is listed in Table 59.

| Object path | Name | | Values | Description |
| --- | --- | --- | --- | --- |
| Files | Array of object. | File | UTF-8 string of up to 63 octets. | The file's name. |
| Attr | UTF-8 string of not less than 1 octet. | The file's attributes as listed in Table 55.  This member is only present if the file is a recorded scene (".scn") or a playlist (".pl"). |
| size | Number | The file's size in octets. |

Table 59 The result object of the "fileList" response

An example of the `fileList` request and response messages is listed in Figure 23.

| Case  Listing all recorded scene and playlist files. | Request Body | {    `req`: "fileList",    `id`: 26,    `params`: {      "pattern": ["*.scn", "*.pl"]    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: "fileList",    `id`: 26,    `result`: {      "files": [        {"file": `Auto-00001.scn`, "attr": "v", "size": 0},        {"file": "Rainbow Chase.scn", "attr": "v", "size": 259072},        {"file": "Startup scene.scn", "attr": "v", "size": 28546048},        {"file": "Looping effects.pl", "attr": "v", "size": 1068},        {"file": `BackupPlaylist.pl`, "attr": "v", "size": 344}      ]    }  } |

Figure 23 Example "fileList" request and response messages

### 7.9.6 Recorded Scene File Information

The client may examine the details of a recorded scene using a `scnFileInfo` request. The request's params object is listed in Table 60.

| Name | Values | Description |
| --- | --- | --- |
| File | UTF-8 string of up to 63 octets. | The filename of the recorded scene. |

Table 60 The params of the "scnFileInfo" request

The request will be rejected if there is no microSD card, the microSD card is being formatted or there is a recording in progress.

The response's result object is listed in Table 61.

| Name | Values | Description |
| --- | --- | --- |
| durMs | Integer 1 to 4294967295. | The duration of the recording in milliseconds. |
| Unis | Integer. | The number of recorded universes. |
| pixPorts | Integer. | The number of recorded pixel output ports. |
| auxPorts | Integer. | The number of recorded auxiliary output ports. |
| Valid | Boolean. | True if the file is a valid recorded scene. |

Table 61 The result object of the "scnFileInfo" response

### 7.9.7 File Upload

#### 7.9.7.1 Initiate File Upload

The client may initiate a file upload to a controller's microSD card using a `fileUpldStart` request. The request's params object is listed in Table 62.

| Name | Values | Description |
| --- | --- | --- |
| file | String. | The name of the file to upload. |
| Size | Integer. | The size of the file in octets. |

Table 62 The params object of the `fileUpldStart` request

The request will be rejected if there is no microSD card, the microSD card is being formatted, there is a recording in progress or there is another file upload in progress.

The response's result object is listed in Table 63.

| Name | Values | Description |
| --- | --- | --- |
| blockLen | Integer. | The file may be too large to be sent as one packet, so it must be split into blocks. This is the controller's maximum block length. |

Table 63 The result object of the `fileUpldStart` response

If the request is accepted, the client should commence sending the file in parts (blocks), until the entire file is transferred.

***Warning:*** *The controller may time-out the file upload if it does not receive a block within 5 seconds.*

Examples of the `fileUpldStart` request and response messages are listed in Figure 24.

| Case  This client requests to upload a file and the controller accepts, with a maximum 1KB block size.  The client may send the first file block next. | Request Body | {    `req`: `fileUpldStart`,    `id`: 1,    `params`: {  "file": `data1.scn`,      "size": 552977    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `fileUpldStart`,    `id`: 1,    `result`: {      "blockLen": 1024    }  } |
| Case  This client requests to upload file but the controller reject with BUSY_ERROR, because another client is already uploading a file. | Request Body | {    `req`: `fileUpldStart`,    `id`: 2,    `params`: {  "file": `data1.scn`,      "size": 552977    }  } |
| Response Body | {    `resp`: `fileUpldStart`,    `id`: 2,    "err": {       `code`: 7,       `msg`: "Another client is already uploading firmware."    }  } |

Figure 24 Example `fileUpldStart` request and response messages

#### 7.9.7.2 Send File Block

`Request`

After initiating a file upload, the client is to send the file one block at a time using a `fileUpldBlock` request. The client must have already initiated a file upload before sending blocks.

The `fileUpldBlock` request is **binary, not JSON text.** If using WebSocket, the frame is **Opcode Binary.** If using HTTP, the Content-Type header is **"application/octet-stream".**

The `fileUpldBlock` request is defined in Table 64. All its multi-byte fields are in network byte order (big-endian, most-significant-byte first).

| Byte Offset | Size (bytes) | Field Name | Value | Description |
| --- | --- | --- | --- | --- |
| 0 | 16 | Type | String `fileUpldBlock`. | The message's type in ASCII characters. To be padded to 16 bytes by zero (0). |
| 16 | 4 | Id | Integer ranging 1 to 4294967295. | If the id is 0, there will be no id member in the JSON response. |
| 20 | 4 | Block offset | Integer ranging 0 to length of the file. | The offset of the block in bytes. |
| 24 | Length to the end of the message | Block | Binary bytes. | A block of the file. |

Table 64 The binary `fileUpldBlock` request

The method for sending file blocks:

1. The block offset of the first file block request must be 0.
2. The successive block offsets must increase by the size of the previous block.
3. The block length must never exceed the "blockLen" indicated in the file upload response. Where possible a client should use the indicated block length for all blocks, except for the last block which may need to be less.
4. The client must wait for the `fileUpldBlock` response before sending the next block.

`Response`

Unlike the request, the `fileUpldBlock` response is **JSON text.** The response has no result object.

***Warning:*** *The controller may time-out a file upload session if the client takes more than five seconds to send the next block request after each response.*

After sending the last response, if the upload completed successfully, the controller also sends a `fileChange` notification to *`all`* WebSocket clients. The notification is sent the client that perform the upload because it includes the file's attributes, if applicable, of which the client may be unaware.

Examples of the `fileUpldBlock` request and response messages are listed in Figure 25. They are hypothetical messages with the following properties:

* The controller's requested block size for the file upload is 32 bytes (this number is very low, just to simplify the examples).
* The file the client is trying to send is 552,977 bytes total size.

| Case  The client sends the first 32-byte block to the controller.  The controller accepts. | Request Body | Offset(h) 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  00000000 66 69 6C 65 55 70 6C 64 42 6C 6F 63 6B 00 00 00 fileUpldBlock...  00000010 00 00 00 01 00 00 00 00 96 52 74 26 61 2E 6C 2D .........Rt&a.l-  00000020 33 78 69 50 00 00 00 00 A0 61 08 00 CE BC D6 F1 3xiP...a..Î¼Öñ{  00000030 7B 45 6E 64 78 0C F7 CB {Endx.÷Ë |
| --- | --- | --- |
| Response Body | {    `resp`: `fileUpldBlock`,    `id`: 1  } |
| Case  The client sends the second 32-byte block to the controller.  The controller accepts. | Request Body | Offset(h) 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  00000000 66 69 6C 65 55 70 6C 64 42 6C 6F 63 6B 00 00 00 fileUpldBlock...  00000010 00 00 00 02 00 00 00 20 C9 46 07 25 CE BC D6 F1 ....... ÉF.%Î¼Öñ  00000020 7B 45 6E 64 78 0C F7 CB C9 46 07 25 35 3A 33 30 {Endx.÷ËÉF.%5:30  00000030 3A 32 39 27 32 30 0D 0A |
| Response Body | {    `resp`: `fileUpldBlock`,    `id`: 2  } |
| Case  The client sends the last block of the file to the controller (which is only 17 bytes). | Request Body | Offset(h) 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F  00000000 66 69 6C 65 55 70 6C 64 42 6C 6F 63 6B 00 00 00 fileUpldBlock...  00000010 00 00 00 03 00 08 70 00 CF 4F 2C 5B 17 34 3D 96 ÏO,[.4=–  00000020 08 B5 FE CC A1 FE 07 5F 88 DA AE B4 00 9C 93 96 .µþÌ¡þ._ˆÚ®´.œ"–  00000020 12 . |
| Response Body | {    `resp`: `fileUpldBlock`,    `id`: 3  } |

Figure 25 Example `fileUpldBlock` request and response messages

### 7.9.8 File Download

The client may download a file from a controller's microSD card using a standard HTTP GET request, with a request line of the form (using ABNF):

"GET /" api-version "/microsd/" filename [ "?" ( user-param / auth-param ) *( "&" ( user-param / auth-param ) ) ] "HTTP/1.1"

Where:

* filename is the name of the file on the microSD card to be downloaded, and
* api-version, user-param and auth-param are as described in Table 3.

***Note:*** *file download is not supported over WebSocket.*

As example, the HTTP request to download the file `test.scn` as administrator user might be:

GET //microsd/test.scn?auth=gM7MUXA_p9QUjl-gx15ba-ACX_0qj2-6eoU62FyVn-4= HTTP/1.1

### 7.9.9 File-Change Notification

The controller sends a `fileChange` notification to WebSocket clients when a file on the microSD card is uploaded, deleted, renamed or its attributes have changed.

The notification's params object is listed in Table 65.

| Name | | | Values | Description | |
| --- | --- | --- | --- | --- | --- |
| typ | | | String. | The name of the storage device that the notification applies. | |
| add | Array of object. | file | UTF-8 strings of up to 63 octets. | List of files created, uploaded or changed on the microSD card. | The file's name. |
| attr | UTF-8 string of not less than 1 octet. | The file's attributes as listed in Table 55.  This member is only present if the file is a recorded scene (".scn") or a playlist (".pl"). |
| size | Integer. | The file's size in octets. |
| del | Array of string. | | UTF-8 string of up to 63 octets. | List of files deleted from the microSD card. | The file's name. |
| ren | Array of object. | file | UTF-8 string of up to 63 octets. | List of files renamed on the microSD card. | The file's old name. |
| newFile | UTF-8 string of up to 63 octets. | The file's new name. |

Table 65 The params object of the `fileChange` notification message

An example of a request that changes files, its response and `fileChange` notification is listed in Figure 26.

| Case | Messages | |
| --- | --- | --- |
| A client requests the deletion of files named `Auto-00004.scn` and `Auto-00005.scn`.  The response to the client accepts the deletion.  The notification to the other WebSocket clients informs them of the deletion. | Request Body | {  `req`: "fileDel",  `id`: 23,  `params`: {  "file": [  `Auto-00004.scn`,  `Auto-00005.scn`  ]  }  } |
| Response Body | {  `resp`: "fileDel",  `id`: 23  } |
| Notification Body | {  `notify`: `fileChange`,  `params`: {  "typ": "microSD",  "del": [  `Auto-00004.scn`,  `Auto-00005.scn`  ]  }  } |

Figure 26 Example "fileDel" request, response and `fileChange` notification messages

## 7.10 Password Change

The client may set or change the administrator user's password-hash using a `passChange` request.

It is recommended that the client re-authenticate its operator before changing the password, to establish they know the current password and therefore have the authority to change it.

The method would be:

1. The operator enters the current password.
2. The operator enters the new password twice. If the new passwords differ, throw an error.
3. The client sends the Base64-encoded SHA-256 of the current password and the Base64-encoded SHA-256 of the new password in a password change request.

The request's params object is listed in Table 66.

| Name | Values | Description |
| --- | --- | --- |
| oldPass | 44-character Base64-encoded string. | The SHA-256 hash of the administrator user's current password text. |
| newPass | 44-character Base64-encoded string. | The SHA-256 hash of the administrator user's new password text. |

Table 66 The params object of the `passChange` request

***Info:*** *Unlike the password hash in HTTP request lines, the password hashes in this message is Base64 encoded (not Base64URL), since they are in the message body.*

The response has no result object. If the request was accepted, after sending the response, the controller also sends a `disconnect` notification (reason PASSWORD_CHANGE) to all the other WebSocket clients. To re-connect, those clients must authenticate using the new password.

An example of the `passChange` request, response and `disconnect` notification messages is listed in Figure 27.

| Case  The client changes the password from "" (empty) to "advatek".  The controller accepts.  The controller sends a disconnect notification to all the other WebSocket clients. | Request Body | {    `req`: `passChange`,    `id`: 1,    `params`: {      "oldPass":"47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",      "newPass":"RktyUHRd/g1gHzZtHJ7Yg5ZNhEgPsHpA7nqTiYGEhxE="    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `passChange`,    `id`: 1  } |
| Notification Body  *Not sent to a WebSocket client that requested the password change.* | {    `notify`: "disconnect",    `params`: {      "reason": {        `code`: 1,        `msg`: "Another client has changed the password."      }    }  } |

Figure 27 Example `passChange` request, response and "disconnect" notification messages

***Warning:*** *A blank password (no password) still has a hash, as shown in the above example.*

## 7.11 Programmed Intensity

The client may change the intensity of an output using a `progInt` request. The request's params object is listed in Table 67.

| Name | | | Values | Default | Description | |
| --- | --- | --- | --- | --- | --- | --- |
| item | Array of object. | out | String of "Pix" or `Aux:N`. | Must be specified. | The output to which the intensity scaling is to be set. | |
| op | String of "Set", "Lo", "LoSet", "Hi" or "HiSet". | Must be specified. | Setting of the programmed intensity's scaling factor and/or setting of the programmed intensity's priority versus live intensity. | |
| fc | Integer ranging 0 to 255. | 0 | The scaling factor to be applied the output. "fc" is shorthand for "factor". | These members are only included if the operation assigns the scaling factor. |
| durMs | Integer ranging 0 to 4294967295. | 0 | The duration, in milliseconds, over which the output's intensity changes linearly to its new scaling factor.  0 = immediate. |

Table 67 The params object of the "progInt" request.

The response has no result object. If the request was accepted, after sending the response, the controller also sends a `statusChange` notification to every WebSocket client each second until all the request's durations ("durMs") have elapsed.

## 7.12 Restart

The client may restart the controller using a `restart` request. The request has no params object.

After sending the response, the controller also sends a `disconnect` notification (reason RESTART).

## 7.13 Statistics

### 7.13.1 Statistic Object

The controller continually counts events (e.g. good and bad Ethernet packets received), measures performance (e.g. frame rates) and external conditions (e.g. temperature and input voltage). These metrics are called statistics and are represented by an object named **`statistic`,** listed in Table 68.

Clients may read the statistic object at any time. WebSocket clients may also subscribe to the statistic object so that the controller periodically sends it the requested statistics.

All the statistic counters are unsigned integers unless stated otherwise. Counters start at zero and may be reset to zero by integer overflow or by a statistic reset request.

<table>
<tr><th>Object Path</th><th>Name</th><th>Values</th><th></th><th>Description</th><th></th></tr>
<tr><td>net</td><td>ipAddr</td><td>String of decbyte "." decbyte "." decbyte "." decbyte, where decbyte is an integer ranging 0 to 255.</td><td></td><td>IPv4 address.</td><td>The current network address.  If DHCP / AutoIP is enabled, these are what were assigned.</td></tr>
<tr><td>netmask</td><td>String of decbyte "." decbyte "." decbyte "." decbyte, where decbyte is an integer ranging 0 to 255.</td><td></td><td>Ipv4 subnet mask.</td><td></td><td></td></tr>
<tr><td>gateway</td><td>String of decbyte "." decbyte "." decbyte "." decbyte, where decbyte is an integer ranging 0 to 255.</td><td></td><td>Ipv4 gateway.</td><td></td><td></td></tr>
<tr><td>dev</td><td>bankVolt</td><td>Array of size constant:dev.pwrBanksIn. The values are integers in units of millivolts.</td><td></td><td>Power input may be split into multiple banks, with each bank having its own connector and voltage monitoring.</td><td>Statistics of the device.</td></tr>
<tr><td>temp.current</td><td>Signed floating-point number in unit of degrees Celsius.</td><td></td><td>Current, minimum and maximum temperature of the controller.</td><td></td><td></td></tr>
<tr><td>temp.min</td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>temp.max</td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>cpu</td><td>Percentage 0 to 100.</td><td></td><td>Current CPU usage</td><td></td><td></td></tr>
<tr><td>pixPwrOuts</td><td>current</td><td>Each member is an array of size constant:dev.pixPorts; one for each pixel output port.</td><td>Integer values in units of milliamps.</td><td>Output port's current draw.  Only relevant when constant:dev.pwrOut is true.</td><td>Statistics of the physical powered pixel output ports.  The statistic:pixPwrOuts and its members are used only if constant:dev.pwrOut is true, and are null otherwise.</td></tr>
<tr><td>fuseGood</td><td>Boolean.</td><td></td><td></td><td></td><td><table border="1"><tr><td>true</td><td>Power output is active (A4-S).  Physical Fuse is not blown (A16-S).</td></tr><tr><td>false</td><td>Power output is inactive (A4-S).  Physical Fuse is blown (A16-S)</td></tr><tr><td>Output port's fuse state.  Reports Overcurrent state on eFuse-equipped boards (A4-S), otherwise it reports the condition of a physical fuse if fitted (A16-S).  Only relevant when constant:dev.pwrOut is true.</td><td></td></tr></table></td></tr>
<tr><td>stat</td><td>String</td><td>`Good` indicates power output is active.  `Inactv` indicates there is no power to the bank.  `OvrCur` indicates that the fuse is in an overcurrent state and power has been removed from the output.  `FuseBlwn` indicates that the physical fuse has blown.</td><td></td><td></td><td></td></tr>
<tr><td>voltage</td><td>Array of integers with length constant:dev.pixPorts if constant:dev.pwrPixVolts is true.  Otherwise, is `null`</td><td>Measured Pixel Port output voltage in millivolts</td><td></td><td></td><td></td></tr>
<tr><td>pixData</td><td>outFrmRate</td><td>Integer in unit of Hz.</td><td></td><td>Output frame rate.</td><td>Statistics of the combined pixel output ports.</td></tr>
<tr><td>inFrmRate</td><td>Integer in unit of Hz.</td><td></td><td>Detected network protocol frame rate.</td><td></td><td></td></tr>
<tr><td>recFrmRate</td><td>Integer in unit of Hz.</td><td></td><td>Frame rate written to file during recording.</td><td></td><td></td></tr>
<tr><td>syncAddr</td><td>Integer ranging 1 to 63999 if sync address is in use, otherwise 0.</td><td></td><td>sACN synchronization address being listened to for synchronization packets.  Only relevant when config:pix.dataSrc = "sACN".</td><td></td><td></td></tr>
<tr><td>forceSync</td><td>Boolean.</td><td></td><td>If external sync is lost, pixel output data will remain frozen while waiting for sync to return.  Only relevant when config:pix.dataSrc = "sACN".</td><td></td><td></td></tr>
<tr><td>extSync</td><td>Boolean.</td><td></td><td>External synchronization packets are being actively received.</td><td></td><td></td></tr>
<tr><td>overrun</td><td>Integer.</td><td></td><td>Number of times incoming network data has been ready before previous pixel data output is finished.</td><td></td><td></td></tr>
<tr><td>overrunDrop</td><td>Integer.</td><td></td><td>Number of times overrun has resulted in dropped incoming frame.</td><td></td><td></td></tr>
<tr><td>liveIntFr</td><td>Integer.</td><td></td><td>The live-intensity-control input's frame rate.</td><td></td><td></td></tr>
<tr><td>liveIntAv</td><td>Boolean.</td><td></td><td>The live-intensity-control input's availability.</td><td></td><td></td></tr>
<tr><td>inPartial</td><td>Integer.</td><td></td><td>The number of "partial" frames received. (Frames where at least one universe is received, but some universes are missing)</td><td></td><td></td></tr>
<tr><td>auxData</td><td>outFrmRate</td><td>Each member is an array of size constant:dev.auxPorts; one for each aux port.</td><td>Integer in unit of Hz.</td><td>Output frame rate.  Only relevant when config:auxPort.mode = "DMX512Out".</td><td>Statistics of the individual auxiliary ports.</td></tr>
<tr><td>inFrmRate</td><td>Integer in unit of Hz.</td><td>When config:auxPort.mode = "DMX512Out", the detected network protocol frame rate for the aux out universe.  When config:auxPort.mode = "DMX512In", the detected incoming DMX512 frame rate.</td><td></td><td></td><td></td></tr>
<tr><td>recFrmRate</td><td>Integer in unit of Hz.</td><td>Frame rate written to file during recording.  Only relevant when config:auxPort.mode = "DMX512Out".</td><td></td><td></td><td></td></tr>
<tr><td>syncAddr</td><td>Integer ranging 1 to 63999 if sync address is in use, otherwise 0.</td><td>sACN synchronization address being listened to for synchronization packets.  Only relevant when config:pix.dataSrc = "sACN" AND config:auxPort.mode = "DMX512Out".</td><td></td><td></td><td></td></tr>
<tr><td>forceSync</td><td>Boolean.</td><td>If external sync is lost, aux output data will remain frozen while waiting for sync to return.  Only relevant when config:pix.dataSrc = "sACN" AND config:auxPort.mode = "DMX512Out".</td><td></td><td></td><td></td></tr>
<tr><td>extSync</td><td>Boolean.</td><td>External synchronization packets are being actively received. Only relevant when config:auxPort.mode = "DMX512Out".</td><td></td><td></td><td></td></tr>
<tr><td>overrun</td><td>Integer.</td><td>Number of times incoming network data has been ready before previous pixel data output is finished. Only relevant when config:auxPort.mode = "DMX512Out".</td><td></td><td></td><td></td></tr>
<tr><td>overrunDrop</td><td>Integer.</td><td>Number of times overrun has resulted in dropped incoming frame. Only relevant when config:auxPort.mode = "DMX512Out".</td><td></td><td></td><td></td></tr>
<tr><td>timedOut</td><td>Boolean.</td><td></td><td></td><td></td><td><table border="1"><tr><td>true</td><td>The aux port is not receiving valid DMX512 in.</td></tr><tr><td>false</td><td>The aux port is currently receiving valid DMX512 in.</td></tr><tr><td>Receive status.  Only relevant when config:auxPort.mode = "DMX512In".</td><td></td></tr></table></td></tr>
<tr><td>liveIntFr</td><td>Integer.</td><td>The live-intensity-control input's frame rate.</td><td></td><td></td><td></td></tr>
<tr><td>liveIntAv</td><td>Boolean.</td><td>The live-intensity-control input's availability.</td><td></td><td></td><td></td></tr>
<tr><td>eth.extp</td><td>linkUp</td><td>Each member is an array of size constant:dev.ethPorts; one for each external ethernet port.</td><td>Boolean.</td><td>Ethernet link is connected.</td><td>Statistics of the external ethernet ports.  The members of statistic:eth.extp used vary between controller types. Unused members are null.</td></tr>
<tr><td>linkSpeed</td><td>Integer of value 10, 100 or 1000</td><td>Link speed in megabits per second.  Value only valid if constant:eth.extp.linkUp is true.  Note it would be highly unusual to be 10Mbps, consider showing a warning.</td><td></td><td></td><td></td></tr>
<tr><td>linkFullDup</td><td>Boolean.</td><td>Link is full duplex.  Value only valid if constant:eth.extp.linkUp is true.  As half duplex would be highly unusual, consider showing a warning.</td><td></td><td></td><td></td></tr>
<tr><td>inUcast</td><td>Integer.</td><td>Number of good unicast frames received.</td><td></td><td></td><td></td></tr>
<tr><td>inMcast</td><td>Integer.</td><td>Number of good multicast frames received.</td><td></td><td></td><td></td></tr>
<tr><td>inBcast</td><td>Integer.</td><td>Number of good broadcast frames received.</td><td></td><td></td><td></td></tr>
<tr><td>inDisc</td><td>Integer.</td><td>Number of good, non-filtered, frames that are received but cannot be forwarded due to insufficient buffer memory.</td><td></td><td></td><td></td></tr>
<tr><td>inFilt</td><td>Integer.</td><td>Number of received frames that were destined for the controller's processor but have been blocked due to filtering rules. This includes ethProt.sACN.inFilt and ethProt.artNet.inFilt as well as any other unrequired packets that were able to be filtered.</td><td></td><td></td><td></td></tr>
<tr><td>outUcast</td><td>Integer.</td><td>Number of unicast frames sent.</td><td></td><td></td><td></td></tr>
<tr><td>outMcast</td><td>Integer.</td><td>Number of multicast frames sent.</td><td></td><td></td><td></td></tr>
<tr><td>outBcast</td><td>Integer.</td><td>Number of broadcast frames sent.</td><td></td><td></td><td></td></tr>
<tr><td>eth.intp</td><td>inUcast</td><td>Integer.</td><td></td><td>Number of good unicast frames received.</td><td>Statistics of the internal ethernet port.  The members of statistic:eth.intp used vary between controller types. Unused members are null.</td></tr>
<tr><td>inMcast</td><td>Integer.</td><td></td><td>Number of good multicast frames received.</td><td></td><td></td></tr>
<tr><td>inBcast</td><td>Integer.</td><td></td><td>Number of good broadcast frames received.</td><td></td><td></td></tr>
<tr><td>inGood</td><td>Integer.</td><td></td><td>Number of good frames received.</td><td></td><td></td></tr>
<tr><td>outUcast</td><td>Integer.</td><td></td><td>Number of unicast frames sent.</td><td></td><td></td></tr>
<tr><td>outMcast</td><td>Integer.</td><td></td><td>Number of multicast frames sent.</td><td></td><td></td></tr>
<tr><td>outBcast</td><td>Integer.</td><td></td><td>Number of broadcast frames sent.</td><td></td><td></td></tr>
<tr><td>outGood</td><td>Integer.</td><td></td><td>Number of good frames sent.</td><td></td><td></td></tr>
<tr><td>ethProt</td><td>inGoodOther</td><td>Integer.</td><td></td><td>Number of good packets received (other than good universe packets described in ethProt.inUni).</td><td>Statistics of the network data protocol.</td></tr>
<tr><td>inBadOther</td><td>Integer.</td><td></td><td>Number of packets received but not required or that contain invalid data. Does not include universe packets dropped due to bad sequence or low priority (described in ethProt.inUni).</td><td></td><td></td></tr>
<tr><td>ethProt.sACN</td><td>inGoodOther</td><td>integer.</td><td></td><td>Number of good E1.31 (sACN) packets received other than used sACN data packets.  Does not include universe packets dropped due to bad sequence or low priority (described in ethProt.inUni.sACN for each universe used by the controller).  Packets counted:   1. E1.31 Synchronization Packets used to synchronize the Pixel/Aux outputs.</td><td>Statistics of the sACN protocol</td></tr>
<tr><td>inBadOther</td><td>Integer.</td><td></td><td>Number of E1.31 (sACN) packets received but not processed.  Packets counted:   1. E1.31 Data Packets with any invalid values in the Header. 2. E1.31 Data Packets containing a universe outside the valid range (1..63999). 3. E1.31 Data Packets containing a universe the controller is not using. 4. E1.31 Synchronization Packets not used to synchronize the Pixel/Aux outputs. 5. Any other E1.31 packet types (including but not limited to E1.31 Universe Discovery Packets and E1.31 Data Packets with Alternate START codes as described in E1.11 and E1.20).</td><td></td><td></td></tr>
<tr><td>inFilt</td><td>Integer.</td><td></td><td>Number of sACN packets discarded by incoming filter (e.g. unused sACN universes sent with multicast addressing).</td><td></td><td></td></tr>
<tr><td>ethProt.artNet</td><td>inGoodOther</td><td>Integer.</td><td></td><td>Number of good Art-Net packets received other than used Art-Net data packets.  Does not include universe packets dropped due to bad sequence (described in ethProt.inUni.artNet for each universe used by the controller).  Packets counted:   1. Art-Net OpPoll and OpSync packets.</td><td>Statistics of the Art-Net protocol</td></tr>
<tr><td>inBadOther</td><td>Integer.</td><td></td><td>Number of Art-Net packets received but not processed.  Packets counted:   1. Art-Net OpDmx data packets containing a universe outside the valid range (0..32767). 2. Art-Net OpDmx data packets containing a universe the controller is not using. 3. Art-Net packets with an invalid ID field or protocol version. 4. Unused Art-Net packet types.</td><td></td><td></td></tr>
<tr><td>inFilt</td><td>integer.</td><td></td><td>Number of Art-Net packets discarded by incoming filter (e.g. unused Art-Net universes).</td><td></td><td></td></tr>
<tr><td>ethProt.inUni.sACN</td><td>uniNum</td><td>Each member is an array of size number of sACN universes consumed by the controller.</td><td>Integer ranging 1 to 63999.</td><td>Network protocol universe number. Refer the config:pixPort.startUni member for information about universe numbering.</td><td>Statistics of the sACN universes the controller is configured for.  statistic:ethProt.inUni.sACN is null if no sACN universes are configured.</td></tr>
<tr><td>timedOut</td><td>Boolean.</td><td>Active data is being received on this universe.</td><td></td><td></td><td></td></tr>
<tr><td>sourceName</td><td>String of maximum length 63 characters.</td><td>Description of the source sending the universe.</td><td></td><td></td><td></td></tr>
<tr><td>inGood</td><td>Integer.</td><td>Number of good packets received per universe.</td><td></td><td></td><td></td></tr>
<tr><td>inBadSeq</td><td>Integer.</td><td>Number of packets received out of order.</td><td></td><td></td><td></td></tr>
<tr><td>inLowPri</td><td>Integer.</td><td>Number of good packets received but discarded because their priority was lower than the active priority.</td><td></td><td></td><td></td></tr>
<tr><td>priority</td><td>Integer ranging 0 to 200.</td><td>Currently active priority number of the universe.</td><td></td><td></td><td></td></tr>
<tr><td>syncAddr</td><td>Integer ranging 1 to 63999 if sync universe is reported, otherwise 0.</td><td>Address that the universe says it will send synchronization packets on.  Note that all universes used for pixel output should have the same sync address for proper operation.</td><td></td><td></td><td></td></tr>
<tr><td>reqForceSync</td><td>Boolean.</td><td>Whether the universe is requesting that the controller wait for sync packets on sync packet timeout.  Note that all universes used for pixel output should have the same forced sync request for proper operation.</td><td></td><td></td><td></td></tr>
<tr><td>ethProt.inUni.artNet</td><td>uniNum</td><td>Each member is an array of size number of Art-Net universes consumed by the controller.</td><td>Integer ranging 1 to 32768.</td><td>Same as ethProt.inUni.sACN.uniNum.</td><td>Statistics of the Art-Net universes the controller is configured for.  statistic:ethProt.inUni.artNet is null if no Art-Net universes are configured.</td></tr>
<tr><td>timedOut</td><td>Boolean.</td><td>Same as ethProt.inUni.sACN.timeOut.</td><td></td><td></td><td></td></tr>
<tr><td>inGood</td><td>Integer.</td><td>Same as ethProt.inUni.sACN.inGood.</td><td></td><td></td><td></td></tr>
<tr><td>inBadSeq</td><td>Integer.</td><td>Same as ethProt.inUni.sACN.uniNum.</td><td></td><td></td><td></td></tr>
<tr><td>trig</td><td>fr</td><td>Each member is an array of size 3.</td><td>Integer or null.</td><td>The trigger input's frame rate.</td><td>Statistics of the trigger inputs.  These statistics apply to trigger input sources of "sACN", `Art-Net` and `Aux:N`, and the array elements are null for "UDP".</td></tr>
<tr><td>av</td><td>Boolean or null.</td><td>The trigger input's availability.</td><td></td><td></td><td></td></tr>
<tr><td>diag</td><td>errCnt</td><td>Integer.</td><td></td><td>The number of errors since start-up.</td><td>Diagnostic information.</td></tr>
<tr><td>err</td><td>String.</td><td></td><td>The most recent error.</td><td></td><td></td></tr>
</table>

Table 68 The `statistic` object

An example of the `statistic` object is listed in Figure 28. It is for the auxiliary port configured as "DMX512Out".

| {    "net": {      "ipAddr": "192.168.0.100",      "netmask": "255.255.225.0",      "gateway": "192.168.0.1"    },    "dev": {      "bankVolt": [5000, 5000],      "temp": {        "current": 32.5,        "min": 19.8,        "max": 33.1      },      "cpu": 0    },    "pixPwrOuts": {      "current": [1000, 1500, 1200, 1300],      "fuseGood": [true, true, true, true]    },    `pixData`: {      "outFrmRate": 45,      "inFrmRate": 45,      "recFrmRate": 45,      "syncAddr": 5,      "forceSync": false,      "extSync": true,      "overrun": 0,      "overrunDrop": 0,      "liveIntFr": 45,      "liveIntAv": true    },    `auxData`: {      "outFrmRate": [0],      "inFrmRate": [0],      "recFrmRate": [0],      "syncAddr": [5],      "forceSync": [false],      "extSync": [false],      "overrun": [0],      "overrunDrop": [0],      "timedOut": [false],      "liveIntFr": [0],      "liveIntAv": [false]    },    "eth": {      "extp": {        "linkUp": [true, true],        "linkSpeed": [1000, 1000],        "linkFullDup": [true, true],        "inUcast": [0, 0],        "inMcast": [0, 0],        "inBcast": [0, 0],        "inDisc": [0, 0],        "inFilt": [0, 0],        "outUcast": [0, 0],        "outMcast": [0, 0],        "outBcast": [0, 0]      },      "intp": {        "inUcast": 0,        "inMcast": 0,        "inBcast": 0,        "inGood": 0,        "outUcast": 0,        "outMcast": 0,        "outBcast": 0,        "outGood": 0      }    },    "ethProt": {      "inGoodOther": 0,      "inBadOther": 0,      "sACN": {        "inGoodOther": 0,        "inBadOther": 0,        "inFilt": 0        },      `artNet`: {        "inGoodOther": 0,        "inBadOther": 0,        "inFilt": 0        },      "inUni": {        "sACN": {          "uniNum": [10, 11, 12],          "timedOut": [false, false, false],          "sourceName": [            "Your Lighting Software",            "Your Lighting Software",            "Your Lighting Software"          ],          "inGood": [1000, 1000, 1000],          "inBadSeq": [0, 0, 0],          "inLowPri": [0, 0, 0],          "priority": [100, 100, 100],          "syncAddr": [200, 200, 200],          "reqForceSync": [false, false, false]        }      }    },    "trig": {      "fr": [45],      "av": [true]    },    "diag": {      "errCnt": 0,      "err": ""    }  } |
| --- |

Figure 28 Example `statistic` object

### 7.13.2 Statistic Read

The client may read the entire statistic object, or parts of it, using a `statisticRead` request. The request's params object is listed in Table 69.

| Name | Values | Description |
| --- | --- | --- |
| path | List of path strings. | Each path string specifies a member of the statistic object using dot-notation.  An empty string will return the entire statistic object.  The maximum list size is 10. |

Table 69 The params object of the `statisticRead` request

The response's result object is listed in Table 70.

| Name | Values | Description |
| --- | --- | --- |
| statistic | Object. | The entire statistic object, or the requested members to be read. |

Table 70 The result object of the `statisticRead` response

Examples of the `statisticRead` request and response messages are listed in Figure 29.

| Case  The client requests to read the entire statistic object. | Request Body | {    `req`: `statisticRead`,    `id`: 1,    `params`: {      `path`: [""]    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `statisticRead`,    `id`: 1,    `result`: {      `statistic`: {        //…      }    }  } |
| Case  The client requests to read two members of the statistic object. | Request Body | {    `req`: `statisticRead`,    `id`: 2,    `params`: {      `path`: [`dev.temp.current`, `pixPwrOuts.fuseGood`]    }  } |
| Response Body | {    `resp`: `statisticRead`,    `id`: 2,    `result`: {      `statistic`: {        "dev" : {          "temp" : {            "current": 32.5          }        },        "pixPwrOuts": {          "fuseGood": [true, true, true, true]        }      }    }  } |

Figure 29 Example `statisticRead` request and response messages

### 7.13.3 Statistic Subscription

The client may subscribe or unsubscribe statistics, or parts of it, using a `statisticSub` request. A client may subscribe to a maximum of 10 JSON paths. The subscription functionality can only be used by a WebSocket client.

***Info:*** *The subscriptions limit is the number of unique JSON paths subscribed to within the statistic object. Multiple objects and members may be in a JSON path. If the client needs to subscribe to many statistics, consider subscribing to a higher level of object (or the entire statistic object).*

Each subscription specifies its notification period in seconds. The controller will send recurring statistic notification messages at that period.

The request's params object is listed in Table 71.

| Name | Values | Description | |
| --- | --- | --- | --- |
| sub | Boolean. | Whether to subscribe or unsubscribe.  `true` = subscribe  `false` = unsubscribe  A client can only unsubscribe individual JSON paths it had previously subscribed to. | |
| period | Integer ranging 1 to 255. | For subscription, the notification period in seconds of objects listed at `path`. | This member is only present if "sub" = true. |
| path | List of path strings. | Each path string specifies a member by dot-notation from the `statistic` object.  An empty string will subscribe or unsubscribe the entire statistic object.  The maximum list size is 10. | If this member is missing, it means subscribe to the entire `statistic` object or unsubscribe from all statistics. |

Table 71 The params object of the `statisticSub` request

The response has no result object.

Example `statisticSub` request and response messages are listed in Figure 30.

| Case  The client subscribes to the entire statistic object at 30 second intervals.       | Request Body                                                     | {    `req`: `statisticSub`,    `id`: 1,    `params`: {      "sub": true,      "period": 30,      `path`: [""]    }  }                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Response Body                                                                            | ```json<br>{    `resp`: `statisticSub`,    `id`: 1  }<br>```<br> |                                                                                                                                        |
| Case  The client subscribes to the pixel output frame rate at 1 second intervals.        | Request Body                                                     | {    `req`: `statisticSub`,    `id`: 2,    `params`: {      "sub": true,      "period": 1,      `path`: [`pixData.outFrmRate`]    }  } |
| Response Body                                                                            | {    `resp`: `statisticSub`,    `id`: 2  }                       |                                                                                                                                        |
| Case  The client unsubscribes from the pixel output frame rate previously subscribed to. | Request Body                                                     | {    `req`: `statisticSub`,    `id`: 3,    `params`: {      "sub": false,      `path`: [`pixData.outFrmRate`]    }  }                  |
| Response Body                                                                            | {    `resp`: `statisticSub`,    `id`: 3  }                       |                                                                                                                                        |

Figure 30 Example `statisticSub` request and response messages

### 7.13.4 Statistic Notification

The controller sends a `statisticSub` notification to a WebSocket client that has previously subscribed statistics. The notification's params object is listed in Table 72.

| Name | Values | Description |
| --- | --- | --- |
| statistic | Object. | The subscribed statistic object.  Since different statistic members can be subscribed at different intervals, this may not contain all the subscribed statistics. |

Table 72 The params object of the `statisticSub` notification

An example of the `statisticSub` notification message is listed in Figure 31.

| Case  A client previously subscribed to the entire statistic object. | Notification Body | {    `notify`: `statisticSub`,    `params`: {      `statistic`: {        //…      }    }  } |
| --- | --- | --- |

Figure 31 Example `statisticSub` notification message

### 7.13.5 Statistic Reset

A client may reset selected statistics of a controller by using a `statisticReset` request. The request's params object is listed in Table 73.

| Name | Values | Description |
| --- | --- | --- |
| path | List of path strings. | Each path string specifies a member of the statistic object using dot-notation.  An empty string will reset the entire statistic object.  The maximum list size is 10. |

Table 73 The params object of the `statisticReset` request

The response has no result object.

Examples of the `statisticReset` request and response messages are listed in Figure 32.

| Case  The client resets the entire statistic object. | Request Body | {    `req`: `statisticReset`,    `id`: 1,    `params`: {      `path`: [""]    }  } |
| --- | --- | --- |
| Response Body | {    `resp`: `statisticReset`,    `id`: 1  } |
| Case  The client resets the minimum and maximum temperature values recorded during the controller's current run time. | Request Body | {    `req`: `statisticReset`,    `id`: 2,    `params`: {      `path`: [`dev.temp.min`, `dev.temp.max`]    }  } |
| Response Body | {    `resp`: `statisticReset`,    `id`: 2  } |

Figure 32 Example `statisticReset` request and response messages

## 7.14 Status

### 7.14.1 Status Object

The controller's running status is represented by an object named **`status`.** Clients may read it at any time. WebSocket clients will be notified whenever the status changes.

The status object is read only. Other messages are used to change the mode of the controller. The `status` object is listed in Table 74.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>mode</td><td>String.</td><td><table border="1"><tr><td>"live"</td><td>The controller's normal operation; streaming external data to its configured output-ports.</td></tr><tr><td>`testData`</td><td>Visually testing the pixel and any auxiliary ports.</td></tr><tr><td>"playback"</td><td>Playing back a scene or playlist.</td></tr><tr><td>"record"</td><td>Recording external data to a scene file on the microSD card.</td></tr><tr><td>The mode of the controller.</td><td></td></tr></table></td></tr>
<tr><td>params</td><td>Object.</td><td>The parameters of the current mode, if any.  Refer [7.7 Modes](#77-modes).</td></tr>
<tr><td>state</td><td>Object.</td><td>The state of the current mode, if any.  Refer [7.14.1.1 State Object](#71411-state-object).</td></tr>
<tr><td>store</td><td>Array of object.</td><td>The state of the storage devices, if any.  Refer [7.14.1.2 Store Object](#71412-store-object).</td></tr>
<tr><td>outInt</td><td>Array of object.</td><td>The output intensity of each output.  Refer [7.14.1.3 Output Intensity Object](#71413-output-intensity-object).</td></tr>
<tr><td>identify</td><td>Integer.</td><td><table border="1"><tr><td>0</td><td>The identify function is disabled.</td></tr><tr><td>1 to 120</td><td>The remaining time in seconds the identify function is to operate.</td></tr><tr><td>121</td><td>The identify function is continuous.</td></tr><tr><td>The state of the identify function.  The identify function operates independently of the mode.  Refer [7.5 Identify](#75-identify).</td><td></td></tr></table></td></tr>
</table>

Table 74 The `status` object

The status object members are dynamic. Refer [7.14.2 Status Read](#7142-status-read) for examples of the status object under various conditions.

#### 7.14.1.1 State Object

This object contains state information depending on the current mode.

**Playback mode**

The status:state object for playback mode is listed in Table 75.

<table>
<tr><th>Name</th><th></th><th>Values</th><th>Description</th><th></th></tr>
<tr><td>cont</td><td></td><td>Boolean.</td><td>True if the mode is continuous (i.e., would never complete).</td><td></td></tr>
<tr><td>err</td><td>code</td><td>Integer.</td><td>A code of the error.  Refer [6.7 Error Codes](#67-error-codes).</td><td>The "err" object is only present if the mode has errored.  The controller's behaviour following an error depends on whether the mode is continuous or transient. Refer [9.2 Terms](#92-terms) for definitions of "continuous", "Transient" and "Impaired".</td></tr>
<tr><td>msg</td><td>String.</td><td>A detailed description of the error.</td><td></td><td></td></tr>
<tr><td>item</td><td></td><td>Integer.</td><td>The position of the current item being played in the playlist.</td><td>These members are only present if a playlist is being played.  *Note:* *The members are not present in the `status` object of the "modePlayback" response because that response is sent before the first item starts. They are indicated in subsequent `statusChange` notifications to WebSocket clients and `statusRead` responses.*  *Note:* *The members change as the playback of each item starts.*</td></tr>
<tr><td>op</td><td></td><td>String.</td><td></td><td><table border="1"><tr><td>"File"</td><td>Play a recorded scene or playlist file.</td></tr><tr><td>"Blank"</td><td>Blank the outputs.</td></tr><tr><td>"Freeze"</td><td>Freeze the outputs.</td></tr><tr><td>"Color"</td><td>Set the color of the outputs.</td></tr><tr><td>The item's playback operation.</td><td></td></tr></table></td></tr>
<tr><td>file</td><td></td><td>UTF-8 string.</td><td>The item's filename, if its "op" is "File".</td><td></td></tr>
<tr><td>color</td><td></td><td>Array of 3 (RGB) or 4 (RGBW) integers, each ranging 0 to 65535.</td><td>The item's color, if its "op" is "Color".</td><td></td></tr>
<tr><td>timS</td><td></td><td>Integer.</td><td>The elapsed time in seconds since the start of the current playback. This may differ its actual playback by +/- 1 second.</td><td></td></tr>
<tr><td>paus</td><td></td><td>Boolean.</td><td>True if playback is paused.</td><td>This member is only present if the modePlayback's "op" or, if it is playing a playlist, the "op" of its current item, is "File".</td></tr>
</table>

Table 75 The status:state object of playback mode

**Record mode**

The status:state object for record mode is listed in Table 76.

| Name | Values | Description |
| --- | --- | --- |
| cont | Boolean | The same as playback mode. |
| err | Object |
| timS | Integer. | The elapsed time in seconds of the current recording. This may differ its actual recording by +/- 1 second.  Its value is 0 (zero) while the recording is awaiting a start condition. |

Table 76 The status:state object of record mode

**All other modes**

The status:state object for all other modes is listed in Table 77.

| Name | Values | Description |
| --- | --- | --- |
| cont | Boolean | The same as playback mode. |
| err | Object |

Table 77 The status:state object of all other modes

#### 7.14.1.2 Store Object

The status:store member is an array of objects representing the storage devices available on the controller. The store array is empty if no storage device exists.

Each member of the array is listed in Table 78.

<table>
<tr><th>Name</th><th>Values</th><th>Description</th></tr>
<tr><td>typ</td><td>String of "MicroSD".</td><td>The device's type. Currently only a microSD card is supported.</td></tr>
<tr><td>speed</td><td>NumberNumber of 0, 2, 4, 6 or 10.</td><td>The device's speed class.</td></tr>
<tr><td>fs</td><td>String.</td><td><table border="1"><tr><td>"FAT32"</td><td>The file system is FAT32.</td></tr><tr><td>"Unknown"</td><td>The file system is unsupported or damaged. Only FAT32 microSD cards are supported.</td></tr><tr><td>"Formatting"</td><td>The storage device is currently being formatted.</td></tr><tr><td>The device's file system.</td><td></td></tr></table></td></tr>
<tr><td>used</td><td>Integer.</td><td>The device's used space in bytes.</td></tr>
<tr><td>avail</td><td>Integer.</td><td>The device's available space in bytes.</td></tr>
</table>

Table 78 The status:store object

#### 7.14.1.3 Output Intensity Object

The status:outInt member is an array of objects; one for each configured output of the controller's possible outputs configured output, i.e. Pixels and any Aux ports currently configured"DMX512Out".

Each member of the array has the form listed in Table 79.

| Name | Values | Description |
| --- | --- | --- |
| out | String of "Pix" or `Aux:N`. | The output, where N is the aux port number. |
| progPri | String of "Lo" or "Hi". | The programmed-intensity-control's priority.  The output's intensity is controlled by either live-intensity or programmed-intensity.  If live-intensity is configured on the output and available, its nominal priority is medium, and it controls the output's intensity except while the programmed-intensity's priority is high. |
| fc | Array of 2 integers ranging 0 to 255. | The current intensity scaling factors for Live and Programmed levels. "fc" is shorthand for factor. |

Table 79 The status:outInt object

### 7.14.2 Status Read

The client may read the entire status object, or parts of it, using a `statusRead` request. The request's params object is listed in Table 80.

| Name | Values | Description |
| --- | --- | --- |
| path | List of path strings. | Each path string specifies a member of the status object using dot-notation.  An empty string will return the entire status object.  The maximum list size is 10. |

Table 80 The params object of the `statusRead` request

The response's result object is listed in Table 81.

| Name | Values | Description |
| --- | --- | --- |
| status | Object. | The entire status object, or the requested members to be read. |

Table 81 The result object of the `statusRead` request

An example of the `statusRead` request and response messages is listed in Figure 33.

| Case  The controller is in live mode and is also identifying itself. The identify functionality will expire 60 seconds from now. | Request Body | {    `req`: `statusRead`,    `id`: 1  } |
| --- | --- | --- |
| Response Body | {    `resp`: `statusRead`,    `id`: 1,    `result`: {      `status`: {        "mode": "live",        //…        "identify": 60      }    }  } |

Figure 33 Example `statusRead` request and response messages

***Warning:*** *When processing this response, remember to follow the rules for backward compatibility specified in the versioning section of this document.*

### 7.14.3 Status-Change Notification

The controller sends a `statusChange` notification to WebSocket clients anytime the status object changes. The client that sends a request which affects the status object will receive the changed status object in the response and therefore that client is not sent a notification.

In cases that only the status:state object has changed, the controller sends the `statusChange` notification nominally once per second.

The notification's params object is listed in Table 82.

| Name | Values | Description |
| --- | --- | --- |
| status | Object. | The entire status object. |

Table 82 The params object of the `statusChange` notification

An example of the `statusChange` notification message is listed in Figure 34.

| Case  The controller is in live mode and is also identifying itself. The identify functionality will expire 60 seconds from now. | Notification Body | {    `notify`: `statusChange`,    `params`: {      `status`: {        "mode": "live",        //…        "identify": 60      }    }  } |
| --- | --- | --- |

Figure 34 Example `statusChange` notification message

## 7.15 Version

A client can request the controller's version information using any of the forms listed in Table 83.

| Version request form | Description |
| --- | --- |
| An HTTP GET `/ver` request. | *A client may need to use this form before sending other API messages, e.g. to establish which APIs and versions the controller supports and whether passwords are configured.*  *Note:* *This form requires neither API-versioning nor authenticating. Refer [4.1 Connection](#41-connection).*  *Note:* *This form has no request body.* |
| A conventional API request by HTTP POST or WebSocket, using a JSON request body. | The client uses a `version` request. The request has no params object. |

Table 83 The forms of version request

The response's result object is common to all forms of the request and is listed in Table 84.

| Name | | | | Value | Description | |
| --- | --- | --- | --- | --- | --- | --- |
| apiVer | Array of object. | | maj | String. | The array lists the API versions supported by the controller. | The Major API version. |
| min | Array of 2 integers. | The range of Minor version numbers of the major version, first lowest, then highest. |
| fwVer | | | | String of maximum length 63 characters. | Firmware version. | |
| prodName | | | | String of maximum length 63 characters. | Product model name. It describes the type of controller. | |
| prodFamily | | | | Integer. | Product family code. | |
| prodFamilyName | | | | String of maximum length 31 characters. | Product family name. | |
| nickname | | | | String of maximum length 63 characters. | Nickname of the controller. | |
| oem | | | | Integer. | Product OEM code. | |
| fwCheckBit | | | | Integer ranging 0 to 255. | Firmware check bit value to be used in firmware-file-validation prior to Firmware Upload. | |
| authReqd | | | | Boolean. | True if the password is non-empty. | For the administrator user. |
| operUser | | en | | Boolean. | True if the user is enabled. | For the operator user. |
| authReqd | | Boolean. | True if the password is non-empty. |
| spaVer | | | | String. | Version of SPA bundled in the controller firmware. | |

Table 84 The result object of the version response

Examples of the version request and response messages are listed in Figure 35.

| Case  The client reads the version. | Request Body | {    `req`: "version",    `id`: 1  } |
| --- | --- | --- |
| Response Body | {    `resp`: "version",    `id`: 1,    `result`: {      "apiVer": [        {          "maj": "v1",          "min": [0,3]        },        {          "maj": "newApi1",          "min": [1,2]        }      ],      "fwVer": "1.2.3",      "prodName": "PixLite A16-S Mk3",      "prodFamily": 1349089331,      "prodFamilyName": "PixLite Mk3",      "nickname": "Roof Left 1",      "oem": 0,      "fwCheckBit": 0,      "authReqd": false,      "spaVer": "1.0.0"    }  } |
| Special Case  GET request to http://ip_address/ver | Request Body | N/A |
| Response Body | {    `resp`: "version",    `result`: {      "apiVer": [        {          "maj": "v1",          "min": [0,3]        },        {          "maj": "newApi1",          "min": [1,2]        }      ],      "fwVer": "1.2.3",      "prodName": "PixLite A16-S Mk3",      "prodFamily": 1349089331,      "prodfamilyName": "PixLite Mk3",      "nickname": "Roof Left 1",      "oem": 0,      "fwCheckBit": 0,      "authReqd": false,      "spaVer": "1.0.0"    }  } |

Figure 35 Example version request and response messages

Using the responses in the fictitious examples above, the client could determine that the controller supports the API versions listed in Table 85.

| Major API | Minor Versions |
| --------- | -------------- |
| v1        | 0, 1, 2, 3     |
| newApi1   | 1, 2           |

Table 85 The APIs supported in the example of Figure 35

# 8 Change History

## 8.1 Document Changelog

Each time an API version number changes, a new API document is released, which has its own version number. When changes are made to released documents, they are listed in Table 86. This document version number is in no way related to the API version number.

| Document Number | Change |
| --- | --- |
| V20251009 | * Corrected config object to add `config:dev.indsEn` |
| V2025 | * Based off PixLite Mk3 API v1.6 document V20250122 * Update to API v1.7. |

Table 86 Document Changelog

## 8.2 API Changelog

| API Version | Details |
| --- | --- |
| V1.7 | * Added statistic to record number of partial frames received (`statistic:pixData.inPartial`) * Added "stat" and "voltage" to `statistic:pixPwrOuts` to reflect fuse status and pixel port voltage. * Added `constant:dev.pwrPixVolts` to reflect if the device can measure the pixel port output voltage |
| V1.6 | * Add "pixMax" and "pixMaxExp" to each pixType in `constant` object. |
| v1.5 | * Add `operIf.colorRes` to the `config` object. * Add `auxPort.colorType`, `auxPort.inFormat` and `auxPort.colorOrder` to the `config` object. * Add "colorRes" to the `modeTestData` and "modePlayback" requests. * Add "fileAttr" request to control visibility of recorded scene and playlist files to operator users. * Add "diag" to the `statistic` object. * Add "state" to the `status` object for all modes (previously applicable to "playback" and "record" only). * Add indicating errored transient modes by `state.err` of the `status` object. * Change `modeTestData` and "modePlayback" requests' default "color" from white to black. * Change playlist file definition. * Add extra Error Code 20 – "Conflicted Error". |
| v1.4 | * Add `oper` (operator) user. * Add `dev.indsEn`, `dev.user` and "operIf" to the `config` object. * Add "restart" request and RESTART disconnect reason. * Add "fadeMs" to the "modeLive", "modePlayback", `modeCtrl` and `playbackCtrl` requests. * Add "Color" operation to the "modePlayback" request and to the modePlayback's `status:state`. * Add "resuming" to the modePlayback's `status:state`. * Add "operUser" object to the "version" response. |
| v1.3 | * Add global and individual current control. * Add pixel output nickname. * Add trigger source nickname. * Add UDP trigger source. * Add optional "cnt" parameter to record start and stop conditions. * Add CPU usage statistic. * Add file-list and firmware upload over HTTP(S). |
| v1.2 | * Add Triggers. * Add Playback. * Add Record. * Add Live and Programmed Intensity. * Add MicroSD card and file management. * Add HTTPS/WSS. |
| v1.1 | * For `config` object:   + Add config:pix.inFormat. * For `statistic` object:   + Add statistic:ethProt.sACN,   + Add statistic:ethProt.artNet. * For `modeTestData` params:   + Increase range of integers in color array to 0 to 65535 if config:pix.inFormat is "16BitHL" or "16BitLH". |
| v1.0 | * Initial release. |

Table 87 API Changelog

# 9 Terminology and Further Information

## 9.1 Abbreviations

| Abbreviation | Definition |
| --- | --- |
| ABNF | Augmented Backus-Naur Form; a notation used to describe formal syntax, defined in RFC 5234. |
| API | Application Programming Interface. |
| FW | Firmware. |
| HTTP | Hypertext Transfer Protocol. |
| JSON | JavaScript Object Notation. |
| LAN | Local Area Network. |
| SPA | Single Page Application; a web application. |
| SHA | Secure Hash Algorithm. |
| UTF | Unicode Transformation Format. |
| WebSocket | WebSocket. |

Table 88 Abbreviations

## 9.2 Terms

<table>
<tr><th>Term</th><th>Definition</th></tr>
<tr><td>Authentication</td><td>Prevent unauthorized access.  A client must authenticate using a password before it can manage the controller.  Unqualified, "authenticate" or "authenticating" means to authenticate with the controller, "authentication" means the process of authenticating, and "authenticated" means after successfully authenticating.</td></tr>
<tr><td>Client</td><td>A device using this API to manage the controller.  Unqualified, "client" typically means the client is authenticated and can actively manage the controller.</td></tr>
<tr><td>Connection</td><td>There are various types of connection between a client and the controller: (a) TCP and HTTP, and (b) WebSocket. The maximum number of concurrent connections of each type is limited by the controller's memory size and processing power.  Unqualified, "connection" typically refers the WebSocket connection.</td></tr>
<tr><td>Configuration</td><td>All the parameters.</td></tr>
<tr><td>Continuous</td><td>Of modes – that the mode will execute without completing, and if it were interrupted by a "transient" mode, that its mode would resume after the transient mode completes. If a continuous mode is unable to execute for some reason, the controller enters an "impaired" state.</td></tr>
<tr><td>Controller</td><td>The PixLite Controller.</td></tr>
<tr><td>Fade</td><td>A duration of intensity ramping optionally performed during transition between Live and Playback modes.</td></tr>
<tr><td>Impaired</td><td>Of continuous modes – that the mode is unable to execute. An example of an impairment is a continuous playback while there is no card in the microSD slot or while its file is missing from the microSD card. The mode will resume if the impairment is removed. Additionally, the impairment may be removed, possibly temporarily, if the controller receives a mode-changing request or trigger.</td></tr>
<tr><td>Intensity</td><td><table border="1"><tr><td>Various functions and configuration to control intensity:</td><td>Intensity Scaling</td></tr><tr><td>A scaling factor applied per pixel output.  Configured at config:pixPort.intensity.</td><td>Live Intensity</td></tr><tr><td>Dynamic control of a pixel and auxiliary output intensity via a DMX512 channel.  Configured at config:pix.liveIntSrc, config:pix.liveIntUni and config:pix.liveIntCh for pixel ports, and at config:auxPort.liveIntSrc, config:auxPort.liveIntUni and config:auxPort.liveIntSrc for auxiliary output ports.</td><td>Programmed Intensity</td></tr><tr><td>Dynamic control of a pixel and auxiliary output intensity via a "progInt" request message or trigger action.</td><td></td></tr></table></td></tr>
<tr><td>Notification</td><td>An unsolicited message from the controller of changes, for example of its status. Notifications are supported only with WebSockets.</td></tr>
<tr><td>Parameter</td><td>A JSON name/value member of the configuration.</td></tr>
<tr><td>Transient</td><td>Of modes – that the mode will execute with limited duration, and on its completion, the controller will resume its last "continuous" mode. If a transient mode is unable to execute for some reason, the mode completes.</td></tr>
</table>

Table 89 Terms

## 9.3 External References

| Reference | Link | Description |
| --- | --- | --- |
| RFC 7230 | <https://www.rfc-editor.org/rfc/rfc7230.html> | HTTP/1.1 Message Syntax and Routing. |
| RFC 7231 | <https://www.rfc-editor.org/rfc/rfc7231.html> | HTTP/1.1 Semantics and Content. |
| RFC 6455 | <https://www.rfc-editor.org/rfc/rfc6455.html> | The WebSocket Protocol. |
| RFC 8259 | <https://www.rfc-editor.org/rfc/rfc8259.html> | The JavaScript Object Notation (JSON) Data Interchange Format. |
| RFC 5234 | <https://www.rfc-editor.org/rfc/rfc5234> | Augmented BNF for Syntax Specifications: ABNF. |
| RFC 4648 | <https://www.rfc-editor.org/rfc/rfc4648.html> | The Base16, Base32, and Base64 Data Encodings. |

Table 90 External References
