package com.whstudio.solco.tailcat

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.whstudio.solco.tailcat.tailcatbridge.Tailcatbridge
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android 11+ denies an app its own netlink queries, so the Go tunnel cannot list interfaces itself
 * ("netlinkrib: permission denied" under an app uid). This feeds it the platform's own view —
 * ConnectivityManager LinkProperties — before the first dial and on every network change, so a Wi-Fi ↔
 * cellular switch gives the tunnel the new default interface at once. Nothing leaves the device.
 */
class NetworkStateReporter(context: Context) {
  private val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private var started = false
  private val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) = push()
    override fun onLost(network: Network) = push()
    override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) = push()
    override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) = push()
  }

  /** Push once now and keep pushing on changes. */
  @Synchronized
  fun start() {
    push()
    if (started) return
    started = true
    runCatching { cm.registerNetworkCallback(NetworkRequest.Builder().build(), callback) }
  }

  @Synchronized
  fun stop() {
    if (!started) return
    started = false
    runCatching { cm.unregisterNetworkCallback(callback) }
  }

  @Synchronized
  fun push() {
    runCatching { Tailcatbridge.setNetworkState(snapshot().toString()) }
      .onFailure { android.util.Log.w("SolcoTailcat", "network snapshot not applied: ${it.message}") }
  }

  private fun snapshot(): JSONObject {
    val interfaces = JSONArray()
    val seen = HashSet<String>()
    interfaces.put(
      JSONObject().put("name", "lo").put("index", 1).put("mtu", 65536).put("up", true).put("loopback", true)
        .put("addrs", JSONArray().put("127.0.0.1/8").put("::1/128")),
    )
    seen.add("lo")
    var index = 2
    for (network in cm.allNetworks) {
      val lp = cm.getLinkProperties(network) ?: continue
      val name = lp.interfaceName ?: continue
      if (!seen.add(name)) continue
      val addrs = JSONArray()
      for (a in lp.linkAddresses) addrs.put("${a.address.hostAddress?.substringBefore('%')}/${a.prefixLength}")
      interfaces.put(
        JSONObject().put("name", name).put("index", index++).put("mtu", if (lp.mtu > 0) lp.mtu else 1500)
          .put("up", true).put("loopback", false).put("addrs", addrs),
      )
    }
    val out = JSONObject().put("interfaces", interfaces)
    val active = cm.activeNetwork?.let { cm.getLinkProperties(it) }
    out.put("defaultInterface", active?.interfaceName ?: "")
    val gateway = active?.routes?.firstOrNull { it.isDefaultRoute && it.gateway is java.net.Inet4Address }?.gateway?.hostAddress
    out.put("gateway", gateway ?: "")
    return out
  }
}
